import getPool from "@/lib/db"
import { redactUrlForLogs, sanitizeUpstreamText } from "@/lib/http"
import type { JobRunItemInput } from "@/lib/job-progress"
import { createLogger } from "@/lib/logger"
import { isRecordDataError, mapPosMerchant } from "@/lib/merchant-import-mapping"
import type { MappedMerchant } from "@/lib/merchant-import-mapping"
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

/** Merchant upsert and its outlets; outlet data errors are caught per outlet. */
async function writeMerchant(
  pool: Pool,
  mapped: Extract<MappedMerchant, { ok: true }>
): Promise<string[]> {
  const { merchant } = mapped
  await pool.query(
    `
    INSERT INTO merchants (external_id, name, fid, outlet_count, status, raw_payload)
    VALUES (?, ?, ?, ?, ?, ?)
    ON DUPLICATE KEY UPDATE
      name = VALUES(name),
      fid = VALUES(fid),
      outlet_count = VALUES(outlet_count),
      status = VALUES(status),
      raw_payload = VALUES(raw_payload),
      updated_at = CURRENT_TIMESTAMP
  `,
    [
      merchant.externalId,
      merchant.name,
      merchant.fid,
      merchant.outletCount,
      merchant.status,
      merchant.rawPayload,
    ]
  )

  const outletProblems = [...mapped.skippedOutlets]
  for (const outlet of mapped.outlets) {
    try {
      await pool.query(
        `
        INSERT INTO merchant_outlets (
          external_id,
          merchant_external_id,
          name,
          status,
          raw_payload
        )
        VALUES (?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
          merchant_external_id = VALUES(merchant_external_id),
          name = VALUES(name),
          status = VALUES(status),
          raw_payload = VALUES(raw_payload),
          updated_at = CURRENT_TIMESTAMP
      `,
        [
          outlet.externalId,
          merchant.externalId,
          outlet.name,
          outlet.status,
          outlet.rawPayload,
        ]
      )
    } catch (error) {
      if (!isRecordDataError(error)) {
        throw error
      }
      outletProblems.push(`outlet ${outlet.externalId}: ${describeWriteError(error)}`)
    }
  }
  return outletProblems
}

function describeWriteError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  return sanitizeUpstreamText(message, [], 300)
}

async function fetchImportWithSession(
  url: URL,
  session: Awaited<ReturnType<typeof authenticatePosApiSession>>
) {
  return fetchPosApiWithSessionInit(url, session)
}

export type MerchantImportPageResult = {
  itemsReturned: number
  /** Merchants written, including those with some outlets skipped. */
  imported: number
  failed: number
  partial: number
  /**
   * Failed and partial merchants only, for `job_run_items`. A fully imported
   * merchant is not logged — that would be one row per merchant per run.
   */
  items: JobRunItemInput[]
  /** Possibly re-authenticated, so the caller must carry it into the next page. */
  session: PosApiAuthSession
  lastLabel: string | null
}

/**
 * Fetch and upsert one page of POS merchants.
 *
 * Extracted from the old `while (hasMore)` loop so the job runner can drive it
 * a page at a time and checkpoint between pages. Previously a failure on page 7
 * of 40 marked the whole run failed with no record of how far it got, and a
 * re-run started again at page 1.
 *
 * A record that cannot be stored (see merchant-import-mapping.ts) is skipped
 * and reported in `items` instead of throwing: one bad record used to fail the
 * page on every retry, and every later run died on the same page.
 */
export async function importMerchantPage(input: {
  pool: Pool
  session: PosApiAuthSession
  page: number
  perPage: number
}): Promise<MerchantImportPageResult> {
  const { pool, perPage, page } = input
  let session = input.session
  let imported = 0
  let failed = 0
  let partial = 0
  const runItems: JobRunItemInput[] = []
  let lastLabel: string | null = null

  const url = new URL(resolvePosImportUrl())
  url.searchParams.set("per_page", String(perPage))
  url.searchParams.set("page", String(page))

  let response = await fetchImportWithSession(url, session)

  // The token is acquired once, but a large import spans many pages and can
  // outlive the POS token's TTL — later pages then 401 with "Unauthenticated".
  // Re-authenticate once and retry this page before treating it as a real
  // auth failure. A fresh token that still 401s falls through to the throw.
  if (response.status === 401) {
    log.warn("POS session rejected; re-authenticating and retrying once", {
      page,
    })
    session = await authenticatePosApiSession()
    response = await fetchImportWithSession(url, session)
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
  const items = getPosApiItems(payload)

  if (!items.length) {
    return {
      itemsReturned: 0,
      imported: 0,
      failed: 0,
      partial: 0,
      items: [],
      session,
      lastLabel: null,
    }
  }

  for (const [index, item] of items.entries()) {
    // Stable across replays of this page, so job_run_items upserts in place.
    const unitIndex = (page - 1) * perPage + index
    const fallbackKey = `page ${page} #${index + 1}`
    const mapped = mapPosMerchant(item)

    if (!mapped.ok) {
      failed += 1
      runItems.push({
        unitIndex,
        unitKey: mapped.unitKey ?? fallbackKey,
        outcome: "failed",
        message: mapped.reason,
      })
      continue
    }

    const unitKey = mapped.merchant.fid ?? mapped.merchant.externalId
    lastLabel = unitKey

    let outletProblems: string[]
    try {
      outletProblems = await writeMerchant(pool, mapped)
    } catch (error) {
      if (!isRecordDataError(error)) {
        throw error
      }
      failed += 1
      runItems.push({
        unitIndex,
        unitKey,
        outcome: "failed",
        message: describeWriteError(error),
      })
      continue
    }

    imported += 1
    if (outletProblems.length) {
      partial += 1
      runItems.push({
        unitIndex,
        unitKey,
        outcome: "partial",
        message: outletProblems.join("; "),
      })
    }
  }

  if (failed > 0) {
    log.warn("Skipped merchant records that could not be stored", {
      page,
      failed,
    })
  }

  return {
    itemsReturned: items.length,
    imported,
    failed,
    partial,
    items: runItems,
    session,
    lastLabel,
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
