/**
 * POS merchant record → `merchants` / `merchant_outlets` row values.
 *
 * Pure and runtime-free so it can be unit-tested under `node --test`.
 *
 * Every value is normalised to fit its column before it reaches MySQL. The
 * database runs in strict mode, so an over-long or mistyped value throws
 * instead of truncating — and before this existed, that one throw failed the
 * whole page, every retry hit the same record, and each new run restarted at
 * page 1 and died there again. Identifiers are never truncated (two different
 * ids could collapse into one row); a record whose identifier does not fit is
 * rejected instead. Display fields are truncated.
 */

type PosRecord = Record<string, unknown>

/** Character limits from schema.sql; VARCHAR counts characters, not bytes. */
export const MERCHANT_COLUMN_LIMITS = {
  externalId: 120,
  fid: 120,
  name: 255,
  status: 60,
} as const

const INT_MIN = -2_147_483_648
const INT_MAX = 2_147_483_647

export type MerchantRowValues = {
  externalId: string
  name: string
  fid: string | null
  outletCount: number
  status: string | null
  rawPayload: string
}

export type OutletRowValues = {
  externalId: string
  name: string
  status: string | null
  rawPayload: string
}

export type MappedMerchant =
  | {
      ok: true
      merchant: MerchantRowValues
      outlets: OutletRowValues[]
      /** One reason per outlet that was dropped before writing. */
      skippedOutlets: string[]
    }
  | {
      ok: false
      /** Best identifier available for the failure log, if any. */
      unitKey: string | null
      reason: string
    }

function isRecord(value: unknown): value is PosRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

/** Strings and finite numbers only — the shapes an id or label can take. */
function toScalarString(value: unknown): string | null {
  if (typeof value === "string") {
    return value
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value)
  }
  if (typeof value === "bigint") {
    return value.toString()
  }
  return null
}

function characterLength(value: string): number {
  return Array.from(value).length
}

/** Truncates by code point so a cut never splits a surrogate pair. */
export function truncateToColumn(value: string, limit: number): string {
  const codePoints = Array.from(value)
  return codePoints.length > limit ? codePoints.slice(0, limit).join("") : value
}

/** First candidate that is a non-empty scalar — the old `a || b || c` chain. */
function firstText(record: PosRecord, keys: readonly string[]): string | null {
  for (const key of keys) {
    const text = toScalarString(record[key])
    if (text) {
      return text
    }
  }
  return null
}

/** First candidate that is present at all — the old `a ?? b ?? c` chain. */
function firstDefined(record: PosRecord, keys: readonly string[]): unknown {
  for (const key of keys) {
    const value = record[key]
    if (value !== null && value !== undefined) {
      return value
    }
  }
  return undefined
}

function mapName(record: PosRecord, keys: readonly string[], fallback: string) {
  return truncateToColumn(
    firstText(record, keys) ?? fallback,
    MERCHANT_COLUMN_LIMITS.name
  )
}

function mapStatus(record: PosRecord): string | null {
  const value = firstDefined(record, ["status", "state", "lifecycle", "status_code"])
  let status: string | null
  if (typeof value === "number") {
    status = value === 1 ? "Active" : value === 0 ? "Inactive" : String(value)
  } else if (typeof value === "boolean") {
    // Matches what the previous code stored: mysql2 sent `true`, which MySQL
    // wrote to the VARCHAR as "1"; `false || null` stored NULL.
    status = value ? "1" : null
  } else {
    status = toScalarString(value) || null
  }
  return status === null
    ? null
    : truncateToColumn(status, MERCHANT_COLUMN_LIMITS.status)
}

function mapOutletCount(record: PosRecord): number {
  const outlets = record.outlets
  let count: number
  if (Array.isArray(outlets)) {
    count = outlets.length
  } else if (isRecord(outlets)) {
    count = 1
  } else {
    const value =
      (outlets as number) ||
      (record.outlet_count as number) ||
      (record.outletCount as number) ||
      0
    count = Number.isFinite(value) ? Number(value) : 0
  }
  // INT column: an out-of-range count would throw in strict mode.
  return Math.min(Math.max(Math.round(count), INT_MIN), INT_MAX)
}

function listOutlets(record: PosRecord): unknown[] {
  const outlets = record.outlets
  if (Array.isArray(outlets)) {
    return outlets
  }
  if (isRecord(outlets)) {
    return [outlets]
  }
  return []
}

function mapOutlet(
  outlet: unknown,
  index: number
): { ok: true; row: OutletRowValues } | { ok: false; reason: string } {
  if (!isRecord(outlet)) {
    return { ok: false, reason: `outlet #${index + 1} is not an object` }
  }

  const rawId = firstDefined(outlet, ["id", "oid", "outlet_id", "code", "outlet_code"])
  const externalId = rawId === undefined ? "" : toScalarString(rawId)
  if (externalId === null) {
    return { ok: false, reason: `outlet #${index + 1} has a non-scalar id` }
  }
  if (!externalId) {
    return { ok: false, reason: `outlet #${index + 1} has no id` }
  }
  if (characterLength(externalId) > MERCHANT_COLUMN_LIMITS.externalId) {
    return {
      ok: false,
      reason: `outlet #${index + 1} id is longer than ${MERCHANT_COLUMN_LIMITS.externalId} characters`,
    }
  }

  return {
    ok: true,
    row: {
      externalId,
      name: mapName(outlet, ["name", "outlet_name", "title"], "Unknown Outlet"),
      status: mapStatus(outlet),
      rawPayload: JSON.stringify(outlet),
    },
  }
}

export function mapPosMerchant(item: unknown): MappedMerchant {
  if (!isRecord(item)) {
    return { ok: false, unitKey: null, reason: "record is not an object" }
  }

  const name = mapName(
    item,
    ["name", "franchise_name", "business_name"],
    "Unknown Merchant"
  )

  // Identity keeps the previous fallback chain, ending at the name.
  const rawId = firstDefined(item, ["id", "fid", "franchise_id", "code"])
  const externalId = rawId === undefined ? name : toScalarString(rawId)
  if (externalId === null) {
    return { ok: false, unitKey: name, reason: "merchant id is not a string or number" }
  }
  if (!externalId) {
    return { ok: false, unitKey: name, reason: "merchant id is empty" }
  }
  if (characterLength(externalId) > MERCHANT_COLUMN_LIMITS.externalId) {
    return {
      ok: false,
      unitKey: truncateToColumn(externalId, 60),
      reason: `merchant id is longer than ${MERCHANT_COLUMN_LIMITS.externalId} characters`,
    }
  }

  const fid = firstText(item, ["id", "fid", "franchise_id"])
  if (fid !== null && characterLength(fid) > MERCHANT_COLUMN_LIMITS.fid) {
    return {
      ok: false,
      unitKey: externalId,
      reason: `fid is longer than ${MERCHANT_COLUMN_LIMITS.fid} characters`,
    }
  }

  const outlets: OutletRowValues[] = []
  const skippedOutlets: string[] = []
  listOutlets(item).forEach((outlet, index) => {
    const mapped = mapOutlet(outlet, index)
    if (mapped.ok) {
      outlets.push(mapped.row)
    } else {
      skippedOutlets.push(mapped.reason)
    }
  })

  return {
    ok: true,
    merchant: {
      externalId,
      name,
      fid,
      outletCount: mapOutletCount(item),
      status: mapStatus(item),
      rawPayload: JSON.stringify(item),
    },
    outlets,
    skippedOutlets,
  }
}

/**
 * MySQL errors caused by one record's values rather than by the database or
 * the code. Only these are skipped per record; anything else (a dropped
 * connection, a syntax error) still fails the slice so it is retried.
 */
const RECORD_DATA_ERROR_CODES = new Set([
  "ER_DATA_TOO_LONG",
  "ER_TRUNCATED_WRONG_VALUE",
  "ER_TRUNCATED_WRONG_VALUE_FOR_FIELD", // e.g. an emoji in a utf8mb3 column
  "ER_WARN_DATA_OUT_OF_RANGE",
  "ER_BAD_NULL_ERROR",
  "ER_INVALID_JSON_TEXT",
  "ER_INVALID_JSON_TEXT_IN_PARAM",
  "ER_INVALID_JSON_CHARSET",
])

export function isRecordDataError(error: unknown): boolean {
  if (!error || typeof error !== "object" || !("code" in error)) {
    return false
  }
  return RECORD_DATA_ERROR_CODES.has(String((error as { code: unknown }).code))
}

/**
 * A run whose share of rejected merchants exceeds this is reported as failed
 * even though it imported everything else. A handful of bad records is upstream
 * noise; a large share means something systemic (a schema change, a new
 * payload shape) that should page someone.
 */
export const MAX_FAILED_MERCHANT_RATIO = 0.05

export function summarizeMerchantImport(totals: {
  processed: number
  failed: number
  partial: number
}): { status: "succeeded" | "failed"; errorMessage: string | null } {
  const { processed, failed, partial } = totals
  if (failed === 0 && partial === 0) {
    return { status: "succeeded", errorMessage: null }
  }

  const parts: string[] = []
  if (failed > 0) {
    parts.push(`${failed} of ${processed} merchants could not be imported`)
  }
  if (partial > 0) {
    parts.push(`${partial} merchants were imported with some outlets skipped`)
  }
  const detail = `${parts.join("; ")}. Per-record reasons are in job_run_items.`

  return processed > 0 && failed / processed > MAX_FAILED_MERCHANT_RATIO
    ? { status: "failed", errorMessage: detail }
    : { status: "succeeded", errorMessage: detail }
}
