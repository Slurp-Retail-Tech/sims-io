/**
 * Multi-row upserts for one page of POS merchants.
 *
 * Pure and runtime-free so it can be unit-tested under `node --test`.
 *
 * The importer used to issue one INSERT per merchant and one per outlet,
 * serially — about 1,100 round trips for a 100-merchant page with ~10 outlets
 * each, which was most of the reason a page could outlive its job lease. A page
 * now costs one merchant statement plus one per OUTLET_BATCH_SIZE outlets.
 */
import { sanitizeUpstreamText } from "./http.ts"
import { isRecordDataError } from "./merchant-import-mapping.ts"
import type { MerchantRowValues, OutletRowValues } from "./merchant-import-mapping.ts"

/**
 * Outlet rows per statement. Bounded so one statement stays far below
 * max_allowed_packet even with large raw payloads, and so a per-row fallback
 * after a data error (see merchant-import.ts) re-runs a bounded set.
 */
export const OUTLET_BATCH_SIZE = 500

export type OutletWrite = OutletRowValues & { merchantExternalId: string }

export type SqlStatement = {
  sql: string
  values: Array<string | number | null>
}

export function chunk<T>(rows: readonly T[], size: number): T[][] {
  if (size < 1) {
    throw new Error("chunk size must be at least 1")
  }
  const chunks: T[][] = []
  for (let index = 0; index < rows.length; index += size) {
    chunks.push(rows.slice(index, index + size))
  }
  return chunks
}

function placeholders(rowCount: number, columnCount: number): string {
  const tuple = `(${Array.from({ length: columnCount }, () => "?").join(", ")})`
  return Array.from({ length: rowCount }, () => tuple).join(",\n      ")
}

export function buildMerchantUpsert(
  rows: readonly MerchantRowValues[]
): SqlStatement {
  if (rows.length === 0) {
    throw new Error("buildMerchantUpsert needs at least one row")
  }
  const values: SqlStatement["values"] = []
  for (const row of rows) {
    values.push(
      row.externalId,
      row.name,
      row.fid,
      row.outletCount,
      row.status,
      row.rawPayload
    )
  }
  return {
    sql: `
    INSERT INTO merchants (external_id, name, fid, outlet_count, status, raw_payload)
    VALUES
      ${placeholders(rows.length, 6)}
    ON DUPLICATE KEY UPDATE
      name = VALUES(name),
      fid = VALUES(fid),
      outlet_count = VALUES(outlet_count),
      status = VALUES(status),
      raw_payload = VALUES(raw_payload),
      updated_at = CURRENT_TIMESTAMP
  `,
    values,
  }
}

export function buildOutletUpsert(rows: readonly OutletWrite[]): SqlStatement {
  if (rows.length === 0) {
    throw new Error("buildOutletUpsert needs at least one row")
  }
  const values: SqlStatement["values"] = []
  for (const row of rows) {
    values.push(
      row.externalId,
      row.merchantExternalId,
      row.name,
      row.status,
      row.rawPayload
    )
  }
  return {
    sql: `
    INSERT INTO merchant_outlets (
      external_id,
      merchant_external_id,
      name,
      status,
      raw_payload
    )
    VALUES
      ${placeholders(rows.length, 5)}
    ON DUPLICATE KEY UPDATE
      merchant_external_id = VALUES(merchant_external_id),
      name = VALUES(name),
      status = VALUES(status),
      raw_payload = VALUES(raw_payload),
      updated_at = CURRENT_TIMESTAMP
  `,
    values,
  }
}

export type RowFailure<Row> = { row: Row; reason: string }

function describeWriteError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  return sanitizeUpstreamText(message, [], 300)
}

/**
 * Run a batch as one statement; if a row's values are rejected, re-run the
 * batch row by row so only the offending rows are lost.
 *
 * InnoDB rolls back the whole failed statement, so the per-row pass re-applies
 * every row — safe because each one is an upsert. Mapping already makes rows
 * fit their columns, so the fallback is for what it cannot predict (a charset
 * the column rejects, say) and is expected to be rare.
 *
 * Returns the rows that failed, each with its reason. Errors that are not about
 * one row's data (a dropped connection) are rethrown so the slice is retried.
 */
export async function upsertWithRowFallback<Row>(
  run: (statement: SqlStatement) => Promise<unknown>,
  rows: readonly Row[],
  build: (rows: readonly Row[]) => SqlStatement
): Promise<Array<RowFailure<Row>>> {
  if (rows.length === 0) {
    return []
  }

  try {
    await run(build(rows))
    return []
  } catch (error) {
    if (!isRecordDataError(error)) {
      throw error
    }
    if (rows.length === 1) {
      return [{ row: rows[0], reason: describeWriteError(error) }]
    }
  }

  const failures: Array<RowFailure<Row>> = []
  for (const row of rows) {
    try {
      await run(build([row]))
    } catch (error) {
      if (!isRecordDataError(error)) {
        throw error
      }
      failures.push({ row, reason: describeWriteError(error) })
    }
  }
  return failures
}
