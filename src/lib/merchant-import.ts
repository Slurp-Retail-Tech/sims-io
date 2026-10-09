import getPool from "@/lib/db"
import { redactUrlForLogs, sanitizeUpstreamText } from "@/lib/http"
import type { JobRunItemInput } from "@/lib/job-progress"
import { createLogger } from "@/lib/logger"
import {
  buildMerchantUpsert,
  buildOutletUpsert,
  chunk,
  OUTLET_BATCH_SIZE,
  upsertWithRowFallback,
} from "@/lib/merchant-import-batch"
import type { OutletWrite, SqlStatement } from "@/lib/merchant-import-batch"
import { mapPosMerchant } from "@/lib/merchant-import-mapping"
import type { MerchantRowValues } from "@/lib/merchant-import-mapping"
import {
  authenticatePosApiSession,
  fetchPosApiWithSessionInit,
  getPosApiItems,
  maskToken,
  resolvePosImportUrl,
} from "@/lib/pos-api"
import type { PosApiAuthSession } from "@/lib/pos-api"
import type { Pool, ResultSetHeader } from "mysql2/promise"

const log = createLogger("merchant-import")

type ImportSummary = {
  imported: number
  pages: number
  completedAt: string
}

async function fetchImportWithSession(
  url: URL,
  session: Awaited<ReturnType<typeof authenticatePosApiSession>>,
  signal?: AbortSignal
) {
  return fetchPosApiWithSessionInit(url, session, signal ? { signal } : {})
}

export type MerchantPageFetch = {
  items: unknown[]
  /** Possibly re-authenticated, so the caller must carry it into the next page. */
  session: PosApiAuthSession
}

/**
 * Fetch one page of POS merchants. No database writes.
 *
 * Split from the write phase so the job handler can renew its lease in
 * between: a slow fetch then cannot eat into the time the writes need, and a
 * slice whose lease was taken mid-fetch stops before writing anything.
 *
 * `signal` bounds the whole phase, including reading the body (httpFetch's own
 * timeout stops at the response headers). An abort surfaces as the caller's
 * abort error, so the caller can tell it apart from an upstream failure.
 */
export async function fetchMerchantPage(input: {
  session: PosApiAuthSession
  page: number
  perPage: number
  signal?: AbortSignal
}): Promise<MerchantPageFetch> {
  const { perPage, page, signal } = input
  let session = input.session

  const url = new URL(resolvePosImportUrl())
  url.searchParams.set("per_page", String(perPage))
  url.searchParams.set("page", String(page))

  let response = await fetchImportWithSession(url, session, signal)

  // The token is acquired once, but a large import spans many pages and can
  // outlive the POS token's TTL — later pages then 401 with "Unauthenticated".
  // Re-authenticate once and retry this page before treating it as a real
  // auth failure. A fresh token that still 401s falls through to the throw.
  if (response.status === 401) {
    log.warn("POS session rejected; re-authenticating and retrying once", {
      page,
    })
    session = await authenticatePosApiSession()
    response = await fetchImportWithSession(url, session, signal)
  }

  if (!response.ok) {
    // Capped and scrubbed: this message lands in the logs and in
    // job_runs.error_message, and an upstream error page can echo the request
    // URL — which, after the 401 fallback, carries the token.
    const errorBody = sanitizeUpstreamText(
      await response.text().catch(() => ""),
      [input.session.token, session.token]
    )
    const details = errorBody ? ` - ${errorBody}` : ""

    if (response.status === 401) {
      // Login already succeeded (we hold a token), so a 401 here means the
      // POS import endpoint rejected the session. Log non-secret signals so
      // we can tell apart a stale/wrong token from the request URL being
      // downgraded over a redirect (which strips the Authorization header).
      const requestProtocol = new URL(url.toString()).protocol
      const finalProtocol = response.url
        ? new URL(response.url).protocol
        : requestProtocol
      log.error(
        "POS import rejected the session token after a successful login",
        undefined,
        {
          // Redacted: the POS 401 fallback puts the token in the query string,
          // so a full URL here would write a live credential into the logs.
          requestUrl: redactUrlForLogs(url.toString()),
          finalUrl: response.url ? redactUrlForLogs(response.url) : null,
          redirected: response.redirected,
          protocolDowngraded: requestProtocol !== finalProtocol,
          hasCookie: Boolean(session.cookieHeader),
          tokenPreview: maskToken(session.token),
        }
      )
    }

    throw new Error(`Import failed with status ${response.status}${details}`)
  }

  const payload = await response.json()
  return { items: getPosApiItems(payload), session }
}

export type MerchantPageWrite = {
  /** Merchants written, including those with some outlets skipped. */
  imported: number
  failed: number
  partial: number
  /**
   * Failed and partial merchants only, for `job_run_items`. A fully imported
   * merchant is not logged — that would be one row per merchant per run.
   */
  items: JobRunItemInput[]
  lastLabel: string | null
}

/**
 * Upsert one fetched page: one statement for its merchants, then one per
 * OUTLET_BATCH_SIZE outlets (previously one INSERT per merchant and per outlet).
 *
 * A record that cannot be stored (see merchant-import-mapping.ts) is skipped
 * and reported in `items` instead of throwing: one bad record used to fail the
 * page on every retry, and every later run died on the same page.
 */
export async function writeMerchantPage(input: {
  pool: Pool
  items: readonly unknown[]
  page: number
  perPage: number
}): Promise<MerchantPageWrite> {
  const { pool, items, page, perPage } = input
  const runItems: JobRunItemInput[] = []

  type Entry = {
    unitIndex: number
    unitKey: string
    merchant: MerchantRowValues
    outlets: OutletWrite[]
    problems: string[]
  }
  const entries: Entry[] = []

  for (const [index, item] of items.entries()) {
    // Stable across replays of this page, so job_run_items upserts in place.
    const unitIndex = (page - 1) * perPage + index
    const mapped = mapPosMerchant(item)
    if (!mapped.ok) {
      runItems.push({
        unitIndex,
        unitKey: mapped.unitKey ?? `page ${page} #${index + 1}`,
        outcome: "failed",
        message: mapped.reason,
      })
      continue
    }
    entries.push({
      unitIndex,
      unitKey: mapped.merchant.fid ?? mapped.merchant.externalId,
      merchant: mapped.merchant,
      outlets: mapped.outlets.map((outlet) => ({
        ...outlet,
        merchantExternalId: mapped.merchant.externalId,
      })),
      problems: [...mapped.skippedOutlets],
    })
  }

  const runStatement = (statement: SqlStatement) =>
    pool.query(statement.sql, statement.values)

  const merchantFailures = await upsertWithRowFallback(
    runStatement,
    entries,
    (batch) => buildMerchantUpsert(batch.map((entry) => entry.merchant))
  )
  const failedEntries = new Set(merchantFailures.map((failure) => failure.row))
  for (const { row, reason } of merchantFailures) {
    runItems.push({
      unitIndex: row.unitIndex,
      unitKey: row.unitKey,
      outcome: "failed",
      message: reason,
    })
  }

  const written = entries.filter((entry) => !failedEntries.has(entry))
  // Outlets of a merchant that failed are not written: they would hang off a
  // merchant row that does not exist.
  const outletOwners = new Map<OutletWrite, Entry>()
  for (const entry of written) {
    for (const outlet of entry.outlets) {
      outletOwners.set(outlet, entry)
    }
  }

  for (const batch of chunk([...outletOwners.keys()], OUTLET_BATCH_SIZE)) {
    const outletFailures = await upsertWithRowFallback(runStatement, batch, buildOutletUpsert)
    for (const { row, reason } of outletFailures) {
      outletOwners.get(row)?.problems.push(`outlet ${row.externalId}: ${reason}`)
    }
  }

  let partial = 0
  for (const entry of written) {
    if (entry.problems.length) {
      partial += 1
      runItems.push({
        unitIndex: entry.unitIndex,
        unitKey: entry.unitKey,
        outcome: "partial",
        message: entry.problems.join("; "),
      })
    }
  }

  const failed = items.length - written.length
  if (failed > 0) {
    log.warn("Skipped merchant records that could not be stored", {
      page,
      failed,
    })
  }

  runItems.sort((a, b) => a.unitIndex - b.unitIndex)
  return {
    imported: written.length,
    failed,
    partial,
    items: runItems,
    lastLabel: written.at(-1)?.unitKey ?? null,
  }
}

export type MerchantImportPageResult = MerchantPageWrite & {
  itemsReturned: number
  session: PosApiAuthSession
}

/** Fetch and write one page with no lease in between — the legacy loop's path. */
export async function importMerchantPage(input: {
  pool: Pool
  session: PosApiAuthSession
  page: number
  perPage: number
}): Promise<MerchantImportPageResult> {
  const fetched = await fetchMerchantPage(input)
  const written = await writeMerchantPage({ ...input, items: fetched.items })
  return {
    ...written,
    itemsReturned: fetched.items.length,
    session: fetched.session,
  }
}

export async function runMerchantImport(trigger: "manual" | "cron") {
  const pool = getPool()
  const [runInsert] = await pool.query<ResultSetHeader>(
    `
    INSERT INTO merchant_import_runs (status, started_at)
    VALUES ('running', CURRENT_TIMESTAMP)
  `
  )
  const runId = String(runInsert.insertId)

  let imported = 0
  let pages = 0

  try {
    let session = await authenticatePosApiSession()

    const perPage = 100
    let page = 1
    let hasMore = true

    while (hasMore) {
      const pageResult = await importMerchantPage({
        pool,
        session,
        page,
        perPage,
      })
      session = pageResult.session
      imported += pageResult.imported
      pages += 1

      await pool.query(
        `
        UPDATE merchant_import_runs
        SET records_imported = ?
        WHERE id = ?
      `,
        [imported, runId]
      )

      if (pageResult.itemsReturned === 0) {
        hasMore = false
        break
      }
      const items = { length: pageResult.itemsReturned }

      await pool.query(
        `
        UPDATE merchant_import_runs
        SET records_imported = ?
        WHERE id = ?
      `,
        [imported, runId]
      )

      if (items.length < perPage) {
        hasMore = false
      } else {
        page += 1
      }
    }

    await pool.query(
      `
      UPDATE merchant_import_runs
      SET status = 'success',
          completed_at = CURRENT_TIMESTAMP,
          records_imported = ?
      WHERE id = ?
    `,
      [imported, runId]
    )

    const [rows] = await pool.query(
      `
      SELECT completed_at
      FROM merchant_import_runs
      WHERE id = ?
    `,
      [runId]
    )
    const completedAt = (rows as Array<{ completed_at: string }>)[0]
      ?.completed_at

    return {
      imported,
      pages,
      completedAt: completedAt ?? new Date().toISOString(),
      trigger,
    } satisfies ImportSummary & { trigger: string }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error"
    await pool.query(
      `
      UPDATE merchant_import_runs
      SET status = 'failed',
          completed_at = CURRENT_TIMESTAMP,
          error_message = ?
      WHERE id = ?
    `,
      [message, runId]
    )
    throw error
  }
}
