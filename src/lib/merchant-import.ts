import getPool from "@/lib/db"
import {
  authenticatePosApi,
  fetchPosApiWithToken,
  getPosApiItems,
  resolvePosImportUrl,
} from "@/lib/pos-api"
import type { ResultSetHeader } from "mysql2/promise"

type PosMerchant = Record<string, unknown>

type ImportSummary = {
  imported: number
  pages: number
  completedAt: string
}

function getName(item: PosMerchant) {
  return (
    (item.name as string) ||
    (item.franchise_name as string) ||
    (item.business_name as string) ||
    "Unknown Merchant"
  )
}

function getExternalId(item: PosMerchant) {
  return String(
    item.id ??
      item.fid ??
      item.franchise_id ??
      item.code ??
      getName(item)
  )
}

function getOutletCount(item: PosMerchant) {
  const outlets = item.outlets
  if (Array.isArray(outlets)) {
    return outlets.length
  }
  if (outlets && typeof outlets === "object") {
    return 1
  }
  const value =
    (outlets as number) ||
    (item.outlet_count as number) ||
    (item.outletCount as number) ||
    0
  return Number.isFinite(value) ? Number(value) : 0
}

function getStatus(item: PosMerchant) {
  const value =
    item.status ?? item.state ?? item.lifecycle ?? item.status_code ?? null
  if (typeof value === "number") {
    if (value === 1) {
      return "Active"
    }
    if (value === 0) {
      return "Inactive"
    }
    return String(value)
  }
  return (value as string) || null
}

function getOutlets(item: PosMerchant) {
  const outlets = item.outlets
  if (Array.isArray(outlets)) {
    return outlets as PosMerchant[]
  }
  if (outlets && typeof outlets === "object") {
    return [outlets as PosMerchant]
  }
  return []
}

function getOutletExternalId(outlet: PosMerchant) {
  return String(
    outlet.id ??
      outlet.oid ??
      outlet.outlet_id ??
      outlet.code ??
      outlet.outlet_code ??
      ""
  )
}

function getOutletName(outlet: PosMerchant) {
  return (
    (outlet.name as string) ||
    (outlet.outlet_name as string) ||
    (outlet.title as string) ||
    "Unknown Outlet"
  )
}

async function fetchImportWithToken(url: URL, token: string) {
  return fetchPosApiWithToken(url, token)
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
    const token = await authenticatePosApi()

    const perPage = 100
    let page = 1
    let hasMore = true

    while (hasMore) {
      const url = new URL(resolvePosImportUrl())
      url.searchParams.set("per_page", String(perPage))
      url.searchParams.set("page", String(page))

      const response = await fetchImportWithToken(url, token)

      if (!response.ok) {
        const errorBody = await response.text().catch(() => "")
        const details = errorBody ? ` - ${errorBody}` : ""
        throw new Error(`Import failed with status ${response.status}${details}`)
      }

      const payload = await response.json()
      const items = getPosApiItems(payload) as PosMerchant[]
      pages += 1

      if (!items.length) {
        hasMore = false
        break
      }

      for (const item of items) {
        const externalId = String(getExternalId(item))
        const name = getName(item)
        const fid =
          (item.id as string) ||
          (item.fid as string) ||
          (item.franchise_id as string) ||
          null
        const outletCount = getOutletCount(item)
        const status = getStatus(item)

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
            externalId,
            name,
            fid,
            outletCount,
            status,
            JSON.stringify(item),
          ]
        )

        const outlets = getOutlets(item)
        for (const outlet of outlets) {
          const outletExternalId = getOutletExternalId(outlet)
          if (!outletExternalId) {
            continue
          }
          const outletName = getOutletName(outlet)
          const outletStatus = getStatus(outlet)

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
              outletExternalId,
              externalId,
              outletName,
              outletStatus,
              JSON.stringify(outlet),
            ]
          )
        }
        imported += 1
      }

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
