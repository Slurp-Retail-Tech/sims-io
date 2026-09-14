import { httpFetch, redactUrlForLogs } from "./http.ts"
import type { HttpAttemptOutcome } from "./http.ts"
import type { Pool, ResultSetHeader, RowDataPacket } from "mysql2/promise"

import getPool from "@/lib/db"
import type { Queryable } from "@/lib/db"
import {
  authenticatePosApiSession,
  fetchPosApiWithSessionInit,
  getPosApiItems,
  resolvePosCategoryBusinessApiUrl,
  resolvePosMerchantIdApiUrl,
  resolvePosApiUrl,
} from "@/lib/pos-api"
import { deleteObject, getObjectBuffer } from "@/lib/storage"
import { parseObjectKey } from "@/lib/storage-keys"
import {
  findDuplicateFids,
  fingerprintSource,
  parseTemplateRows,
  sliceRows,
  type ParsedTemplateRow,
} from "./plus-import-rows.ts"
import {
  planRowPhases,
  rowOutcome,
  type PlusPhaseRecord,
} from "./plus-import-plan.ts"
import { createPosSessionHolder } from "./pos-session.ts"

import { PLUS_IMPORT_JOB_TYPE } from "./job-types.ts"

export { PLUS_IMPORT_JOB_TYPE }

const TARGET_OID = "1"

type JsonRecord = Record<string, unknown>

type CategoryBusinessOption = {
  id: number
  name: string
  sub_name: string
}

type CategoryBusinessMatch =
  | {
      option: CategoryBusinessOption
      status: "matched"
    }
  | {
      option: null
      status: "missing" | "ambiguous"
    }

type MerchantJoinRow = RowDataPacket & {
  merchant_id: string
  merchant_external_id: string
  merchant_name: string
  fid: string | null
  merchant_raw_payload: unknown
  outlet_row_id: string | null
  outlet_external_id: string | null
  outlet_name: string | null
  outlet_raw_payload: unknown
}

type MerchantSourceRecord = {
  merchantId: string
  merchantExternalId: string
  merchantName: string
  fid: string
  merchantRawPayload: JsonRecord | null
  outletRowId: string | null
  outletExternalId: string | null
  outletName: string | null
  outletRawPayload: JsonRecord | null
}

type CurrentOutletState = {
  merchantId: string | null
}

/** Per-call ceiling for the two POS writes this job makes per row. */
const PLUS_POS_TIMEOUT_MS = 15_000

/**
 * POS writes in this job set an absolute target value rather than applying a
 * delta, so re-sending one converges on the same state — which is what makes
 * retrying a PATCH safe here even though `defaultShouldRetry` refuses
 * non-idempotent methods in general. A timeout is the case that matters: the
 * write may well have landed, and re-applying the same value is harmless.
 */
const RETRY_ABSOLUTE_POS_WRITE = (outcome: HttpAttemptOutcome): boolean => {
  if (outcome.kind === "error") {
    return true
  }
  return [429, 502, 503, 504].includes(outcome.response.status)
}

export type PlusPreviewRow = {
  rowNumber: number
  fid: string
  tenantName: string
  merchantName: string | null
  outletName: string | null
  currentMerchantId: string | null
  oldMerchantId: string
  newMerchantId: string
  oldCategoryText: string
  newCategoryText: string
  resolvedCategoryBusinessId: number | null
  resolvedCategoryBusinessLabel: string | null
  willUpdateMerchantId: boolean
  willUpdateCategoryBusiness: boolean
  status: "ready" | "skipped"
  reason: string | null
}

export type PlusUpdateSummaryItem = {
  fid: string
  rowNumber: number
  merchantName: string | null
  outletName: string | null
  reason: string
}

export type PlusUpdateSummary = {
  totalRows: number
  processed: number
  updatedCount: number
  skippedCount: number
  failedCount: number
  skipped: PlusUpdateSummaryItem[]
  failed: PlusUpdateSummaryItem[]
}

type PlusUpdateJobStatus = "running" | "completed" | "failed"
type PlusUpdateJobRow = RowDataPacket & {
  id: string
  status: PlusUpdateJobStatus
  requested_by: string | null
  upload_key: string | null
  total_rows: number
  processed_rows: number
  updated_count: number
  skipped_count: number
  failed_count: number
  summary_json: unknown
  error_message: string | null
  started_at: string
  finished_at: string | null
}

function parsePayload(rawPayload: unknown) {
  if (typeof rawPayload === "string") {
    try {
      return JSON.parse(rawPayload) as JsonRecord
    } catch {
      return null
    }
  }

  if (rawPayload && typeof rawPayload === "object" && !Array.isArray(rawPayload)) {
    return rawPayload as JsonRecord
  }

  return null
}

function readScalarCandidate(payload: JsonRecord | null, keys: string[]) {
  if (!payload) {
    return null
  }

  for (const key of keys) {
    const value = payload[key]
    if (typeof value === "string" && value.trim()) {
      return value.trim()
    }
    if (typeof value === "number" && Number.isFinite(value)) {
      return String(value)
    }
  }

  return null
}

function normalizeText(value: string | null) {
  return value?.trim().toLowerCase() ?? ""
}

function getOutletCurrentState(payload: JsonRecord | null): CurrentOutletState {
  return {
    merchantId: readScalarCandidate(payload, ["merchant_id", "merchantId"]),
  }
}


async function fetchCategoryBusinessOptions() {
  const session = await authenticatePosApiSession()
  return fetchCategoryBusinessOptionsWithSession(session)
}

async function fetchCategoryBusinessOptionsWithSession(
  session: Awaited<ReturnType<typeof authenticatePosApiSession>>
) {
  const response = await fetchPosApiWithSessionInit(
    resolvePosApiUrl("/api/category-business"),
    session
  )

  if (!response.ok) {
    const details = await response.text().catch(() => "")
    throw new Error(
      details
        ? `Unable to load category business list: ${details}`
        : "Unable to load category business list."
    )
  }

  const payload = await response.json()
  return getPosApiItems(payload)
    .map((item) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) {
        return null
      }
      const record = item as Record<string, unknown>
      const id = Number(record.id)
      const name = typeof record.name === "string" ? record.name.trim() : ""
      const subName =
        typeof record.sub_name === "string" ? record.sub_name.trim() : ""
      if (!Number.isFinite(id) || !name || !subName) {
        return null
      }
      return {
        id,
        name,
        sub_name: subName,
      } satisfies CategoryBusinessOption
    })
    .filter((item): item is CategoryBusinessOption => item !== null)
}

async function buildPreviewFromTemplate(
  key: string,
  categories: CategoryBusinessOption[]
) {
  const { preview } = await loadPreviewWithFingerprint(key, categories)
  return preview
}

/**
 * Read the spreadsheet and fingerprint the bytes it was built from.
 *
 * A run resumed after a reclaimed lease must be processing the same file it
 * started on: its saved row index is an offset into THIS parse, so a different
 * file under the same key would silently point at unrelated rows.
 */
async function loadPreviewWithFingerprint(
  key: string,
  categories: CategoryBusinessOption[]
) {
  const bucket = process.env.MINIO_BUCKET
  if (!bucket) {
    throw new Error("Storage is not configured.")
  }

  const buffer = await getObjectBuffer(bucket, key)
  return {
    preview: await buildPreviewFromBuffer(buffer, categories),
    fingerprint: fingerprintSource(buffer),
  }
}

async function buildPreviewFromBuffer(
  buffer: Buffer,
  categories: CategoryBusinessOption[]
) {
  const rows = parseTemplateRows(buffer)
  const uniqueFids = Array.from(new Set(rows.map((row) => row.fid).filter(Boolean)))
  const duplicates = findDuplicateFids(rows)

  const pool = getPool()
  const merchantMap = await loadMerchantSourceRecords(pool, uniqueFids)
  const matchCategory = createCategoryMatcher(categories)

  const previewRows = rows.map((row) => {
    const merchantRecords = merchantMap.get(row.fid) ?? []
    const merchantRecord = merchantRecords[0] ?? null
    const currentState = merchantRecord
      ? getOutletCurrentState(merchantRecord.outletRawPayload)
      : null
    const categoryMatch = matchCategory(row.newCategoryText)
    const reason = getPreviewReason({
      row,
      duplicateFid: duplicates.has(row.fid),
      merchantRecords,
      categoryMatch,
      currentState,
    })

    const resolvedOption = categoryMatch.option
    const willUpdateMerchantId =
      !reason &&
      normalizeText(currentState?.merchantId ?? null) !== normalizeText(row.newMerchantId)
    const willUpdateCategoryBusiness =
      !reason &&
      Boolean(resolvedOption) &&
      normalizeText(row.oldCategoryText) !== normalizeText(row.newCategoryText)

    return {
      rowNumber: row.rowNumber,
      fid: row.fid,
      tenantName: row.tenantName,
      merchantName: merchantRecord?.merchantName ?? null,
      outletName: merchantRecord?.outletName ?? null,
      currentMerchantId: currentState?.merchantId ?? null,
      oldMerchantId: row.oldMerchantId,
      newMerchantId: row.newMerchantId,
      oldCategoryText: row.oldCategoryText,
      newCategoryText: row.newCategoryText,
      resolvedCategoryBusinessId: resolvedOption?.id ?? null,
      resolvedCategoryBusinessLabel: resolvedOption
        ? `${resolvedOption.name} / ${resolvedOption.sub_name}`
        : null,
      willUpdateMerchantId,
      willUpdateCategoryBusiness,
      status: reason ? "skipped" : "ready",
      reason,
    } satisfies PlusPreviewRow
  })

  return {
    rows: previewRows,
    totals: {
      totalRows: previewRows.length,
      readyCount: previewRows.filter((row) => row.status === "ready").length,
      skippedCount: previewRows.filter((row) => row.status === "skipped").length,
    },
    // Carried out rather than discarded: the update loop used to re-query this
    // one FID at a time, which is one SELECT per spreadsheet row on top of the
    // bulk load that already happened here.
    merchantsByFid: merchantMap,
  }
}

function createCategoryMatcher(options: CategoryBusinessOption[]) {
  const subNameMap = new Map<string, CategoryBusinessOption | null>()
  const nameMap = new Map<string, CategoryBusinessOption | null>()

  const register = (
    map: Map<string, CategoryBusinessOption | null>,
    key: string,
    option: CategoryBusinessOption
  ) => {
    const normalized = normalizeText(key)
    if (!normalized) {
      return
    }
    if (!map.has(normalized)) {
      map.set(normalized, option)
      return
    }
    const existing = map.get(normalized)
    if (!existing || existing.id !== option.id) {
      map.set(normalized, null)
    }
  }

  for (const option of options) {
    register(subNameMap, option.sub_name, option)
    register(nameMap, option.name, option)
  }

  return (value: string): CategoryBusinessMatch => {
    const normalized = normalizeText(value)
    if (!normalized) {
      return { option: null, status: "missing" }
    }

    if (subNameMap.has(normalized)) {
      const option = subNameMap.get(normalized)
      if (option) {
        return { option, status: "matched" }
      }
      return { option: null, status: "ambiguous" }
    }

    if (nameMap.has(normalized)) {
      const option = nameMap.get(normalized)
      if (option) {
        return { option, status: "matched" }
      }
      return { option: null, status: "ambiguous" }
    }

    return { option: null, status: "missing" }
  }
}

async function loadMerchantSourceRecords(pool: Pool, fids: string[]) {
  if (!fids.length) {
    return new Map<string, MerchantSourceRecord[]>()
  }

  const placeholders = fids.map(() => "?").join(", ")
  const [rows] = await pool.query<MerchantJoinRow[]>(
    `
    SELECT
      m.id AS merchant_id,
      m.external_id AS merchant_external_id,
      m.name AS merchant_name,
      m.fid,
      m.raw_payload AS merchant_raw_payload,
      o.id AS outlet_row_id,
      o.external_id AS outlet_external_id,
      o.name AS outlet_name,
      o.raw_payload AS outlet_raw_payload
    FROM merchants m
    LEFT JOIN merchant_outlets o
      ON o.merchant_external_id = m.external_id
     AND o.external_id = ?
    WHERE m.fid IN (${placeholders})
  `,
    [TARGET_OID, ...fids]
  )

  const grouped = new Map<string, MerchantSourceRecord[]>()

  for (const row of rows) {
    if (!row.fid) {
      continue
    }

    const record: MerchantSourceRecord = {
      merchantId: String(row.merchant_id),
      merchantExternalId: row.merchant_external_id,
      merchantName: row.merchant_name,
      fid: row.fid,
      merchantRawPayload: parsePayload(row.merchant_raw_payload),
      outletRowId: row.outlet_row_id ? String(row.outlet_row_id) : null,
      outletExternalId: row.outlet_external_id,
      outletName: row.outlet_name,
      outletRawPayload: parsePayload(row.outlet_raw_payload),
    }

    const existing = grouped.get(record.fid) ?? []
    existing.push(record)
    grouped.set(record.fid, existing)
  }

  return grouped
}

function getPreviewReason(input: {
  row: ParsedTemplateRow
  duplicateFid: boolean
  merchantRecords: MerchantSourceRecord[]
  categoryMatch: CategoryBusinessMatch
  currentState: CurrentOutletState | null
}) {
  const {
    row,
    duplicateFid,
    merchantRecords,
    categoryMatch,
    currentState,
  } = input

  if (!row.fid) {
    return "Missing FID."
  }
  if (duplicateFid) {
    return "Duplicate FID in template."
  }
  if (!row.newMerchantId || !row.newCategoryText) {
    return "Missing new merchant_id or trade category."
  }
  if (merchantRecords.length === 0) {
    return "Merchant not found in DB."
  }
  if (merchantRecords.length > 1) {
    return "Multiple merchants found for FID."
  }

  const merchantRecord = merchantRecords[0]
  if (!merchantRecord.outletRowId || merchantRecord.outletExternalId !== TARGET_OID) {
    return "Outlet OID 1 not found."
  }
  if (!currentState) {
    return "Outlet payload is missing."
  }
  const currentMerchantId = normalizeText(currentState.merchantId)
  const oldMerchantId = normalizeText(row.oldMerchantId)
  const newMerchantId = normalizeText(row.newMerchantId)
  if (currentMerchantId !== oldMerchantId && currentMerchantId !== newMerchantId) {
    return "Old merchant_id does not match DB."
  }
  if (categoryMatch.status === "ambiguous") {
    return "Trade category matches multiple category business records."
  }
  if (categoryMatch.status === "missing" || !categoryMatch.option) {
    return "Trade category could not be resolved."
  }

  const merchantChanged =
    normalizeText(currentState.merchantId) !== normalizeText(row.newMerchantId)
  const categoryChanged =
    normalizeText(row.oldCategoryText) !== normalizeText(row.newCategoryText)
  if (!merchantChanged && !categoryChanged) {
    return "No changes detected."
  }

  return null
}

function createSummaryItem(row: PlusPreviewRow, reason: string): PlusUpdateSummaryItem {
  return {
    fid: row.fid,
    rowNumber: row.rowNumber,
    merchantName: row.merchantName,
    outletName: row.outletName,
    reason,
  }
}

export async function previewPlusTemplate(key: string) {
  // Defensive: routes validate the key, but future callers inherit the check.
  if (!parseObjectKey(key)) {
    throw new Error("Invalid upload key.")
  }
  const categories = await fetchCategoryBusinessOptions()
  return buildPreviewFromTemplate(key, categories)
}

function updateOutletPayload(
  payload: JsonRecord | null,
  input: { merchantId?: string; categoryOption?: CategoryBusinessOption }
) {
  const nextPayload = payload ? { ...payload } : {}
  if (input.merchantId) {
    nextPayload.merchant_id = input.merchantId
  }
  if (input.categoryOption) {
    nextPayload.category_business = {
      id: input.categoryOption.id,
      name: input.categoryOption.name,
      sub_name: input.categoryOption.sub_name,
    }
    nextPayload.category_business_id = input.categoryOption.id
  }
  return nextPayload
}

function updateMerchantPayloadOutlet(
  payload: JsonRecord | null,
  input: { merchantId?: string; categoryOption?: CategoryBusinessOption }
) {
  if (!payload) {
    return null
  }

  const outlets = payload.outlets
  if (Array.isArray(outlets)) {
    let changed = false
    const nextOutlets = outlets.map((outlet) => {
      if (!outlet || typeof outlet !== "object" || Array.isArray(outlet)) {
        return outlet
      }
      const outletRecord = outlet as JsonRecord
      const oid =
        readScalarCandidate(outletRecord, ["id", "oid", "outlet_id", "external_id"]) ?? ""
      if (oid !== TARGET_OID) {
        return outlet
      }
      changed = true
      return updateOutletPayload(outletRecord, input)
    })
    if (!changed) {
      return null
    }
    return {
      ...payload,
      outlets: nextOutlets,
    }
  }

  if (outlets && typeof outlets === "object") {
    const outletRecord = outlets as JsonRecord
    const oid =
      readScalarCandidate(outletRecord, ["id", "oid", "outlet_id", "external_id"]) ?? ""
    if (oid !== TARGET_OID) {
      return null
    }
    return {
      ...payload,
      outlets: updateOutletPayload(outletRecord, input),
    }
  }

  return null
}

async function syncLocalMerchantCache(
  pool: Pool,
  record: MerchantSourceRecord,
  input: { merchantId?: string; categoryOption?: CategoryBusinessOption }
) {
  if (!record.outletRowId) {
    return
  }

  const nextOutletPayload = updateOutletPayload(record.outletRawPayload, input)
  await pool.query<ResultSetHeader>(
    `
    UPDATE merchant_outlets
    SET raw_payload = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `,
    [JSON.stringify(nextOutletPayload), record.outletRowId]
  )

  const nextMerchantPayload = updateMerchantPayloadOutlet(record.merchantRawPayload, input)
  if (nextMerchantPayload) {
    await pool.query<ResultSetHeader>(
      `
      UPDATE merchants
      SET raw_payload = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `,
      [JSON.stringify(nextMerchantPayload), record.merchantId]
    )
  }

  record.outletRawPayload = nextOutletPayload
  if (nextMerchantPayload) {
    record.merchantRawPayload = nextMerchantPayload
  }
}

/**
 * True while a non-terminal job still needs this spreadsheet.
 *
 * The client fires cleanup on unmount, and the in-tab dialog guard does not
 * cover a closed tab or a navigation — so without this a running or retryable
 * job can have its source deleted out from under it.
 */
export async function isPlusUploadInUse(
  db: Queryable,
  key: string
): Promise<boolean> {
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT 1 FROM job_runs
      WHERE job_type = ?
        AND artifact_key = ?
        AND status IN ('queued', 'running')
      LIMIT 1`,
    [PLUS_IMPORT_JOB_TYPE, key]
  )
  return rows.length > 0
}

export async function cleanupPlusUpload(key: string) {
  // Defensive: routes validate the key, but future callers inherit the check.
  if (!parseObjectKey(key)) {
    throw new Error("Invalid upload key.")
  }
  const bucket = process.env.MINIO_BUCKET
  if (!bucket) {
    throw new Error("Storage is not configured.")
  }
  await deleteObject(bucket, key)
}


export async function createPlusUpdateJob(
  pool: Pool,
  input: { requestedBy: string | null; uploadKey: string }
) {
  const [result] = await pool.query<ResultSetHeader>(
    `
    INSERT INTO plus_update_jobs (status, requested_by, upload_key)
    VALUES ('running', ?, ?)
  `,
    [input.requestedBy, input.uploadKey]
  )

  return String(result.insertId)
}

export async function getPlusUpdateJob(jobId: string) {
  const pool = getPool()
  const [rows] = await pool.query<PlusUpdateJobRow[]>(
    `
    SELECT id, status, requested_by, upload_key, total_rows, processed_rows,
           updated_count, skipped_count, failed_count, summary_json, error_message,
           started_at, finished_at
    FROM plus_update_jobs
    WHERE id = ?
    LIMIT 1
  `,
    [jobId]
  )

  const row = rows[0]
  if (!row) {
    return null
  }

  const summary =
    typeof row.summary_json === "string"
      ? (JSON.parse(row.summary_json) as PlusUpdateSummary)
      : (row.summary_json as PlusUpdateSummary | null)

  return {
    id: row.id,
    status: row.status,
    requestedBy: row.requested_by,
    uploadKey: row.upload_key,
    totalRows: row.total_rows,
    processedRows: row.processed_rows,
    updatedCount: row.updated_count,
    skippedCount: row.skipped_count,
    failedCount: row.failed_count,
    summary: summary ?? null,
    errorMessage: row.error_message,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
  }
}

async function updatePlusUpdateJobProgress(
  pool: Pool,
  input: {
    jobId: string
    summary: PlusUpdateSummary
  }
) {
  await pool.query(
    `
    UPDATE plus_update_jobs
    SET total_rows = ?,
        processed_rows = ?,
        updated_count = ?,
        skipped_count = ?,
        failed_count = ?,
        summary_json = ?
    WHERE id = ?
  `,
    [
      input.summary.totalRows,
      input.summary.processed,
      input.summary.updatedCount,
      input.summary.skippedCount,
      input.summary.failedCount,
      JSON.stringify(input.summary),
      input.jobId,
    ]
  )
}

async function updatePlusUpdateJob(
  pool: Pool,
  input: {
    jobId: string
    status: PlusUpdateJobStatus
    summary: PlusUpdateSummary
    errorMessage?: string | null
  }
) {
  await pool.query(
    `
    UPDATE plus_update_jobs
    SET status = ?,
        total_rows = ?,
        processed_rows = ?,
        updated_count = ?,
        skipped_count = ?,
        failed_count = ?,
        summary_json = ?,
        error_message = ?,
        finished_at = CURRENT_TIMESTAMP(3)
    WHERE id = ?
  `,
    [
      input.status,
      input.summary.totalRows,
      input.summary.processed,
      input.summary.updatedCount,
      input.summary.skippedCount,
      input.summary.failedCount,
      JSON.stringify(input.summary),
      input.errorMessage ?? null,
      input.jobId,
    ]
  )
}


export type PlusSliceOptions = {
  /** Absolute row index to resume from. */
  fromRowIndex?: number
  /** Maximum rows this slice may process. */
  maxRows?: number
  /** Stop starting new rows once this epoch-ms passes. */
  deadlineAt?: number
  /** Fingerprint recorded on the first slice; a mismatch aborts the run. */
  expectedFingerprint?: string | null
  /** Called after each row so the caller can checkpoint. Returning false aborts. */
  onRowComplete?: (state: {
    rowIndex: number
    summary: PlusUpdateSummary
    phases: Record<string, PlusPhaseRecord> | null
    outcome: string
    fid: string
  }) => Promise<boolean>
}

export type PlusSliceResult = {
  summary: PlusUpdateSummary
  fingerprint: string
  nextRowIndex: number
  totalRows: number
  done: boolean
  /** True when the caller's onRowComplete asked to stop (lease lost). */
  aborted: boolean
}

export async function runPlusUpdateJob(
  jobId: string,
  onProgress: (event: Record<string, unknown>) => void = () => undefined,
  options: PlusSliceOptions = {}
) {
  const pool = getPool()
  const job = await getPlusUpdateJob(jobId)
  if (!job || !job.uploadKey) {
    throw new Error("PLUS update job not found.")
  }

  let summary: PlusUpdateSummary = {
    totalRows: 0,
    processed: 0,
    updatedCount: 0,
    skippedCount: 0,
    failedCount: 0,
    skipped: [],
    failed: [],
  }

  try {
    // A holder, not a captured token: the previous code authenticated once
    // before the row loop, so a long run started failing every remaining row
    // once the POS token's TTL expired.
    const posSession = createPosSessionHolder()
    const categories = await fetchCategoryBusinessOptionsWithSession(
      await posSession.get()
    )
    const { preview, fingerprint } = await loadPreviewWithFingerprint(
      job.uploadKey,
      categories
    )

    // The saved row index is an offset into THIS parse, so a file swapped under
    // the same key would resume against unrelated rows. Fail the run rather
    // than guess which file was intended.
    if (
      options.expectedFingerprint &&
      options.expectedFingerprint !== fingerprint
    ) {
      throw new Error(
        "Source spreadsheet changed between attempts; re-upload to retry."
      )
    }

    const matchCategory = createCategoryMatcher(categories)
    const fromRowIndex = options.fromRowIndex ?? 0
    const rowsToProcess = sliceRows(
      preview.rows,
      fromRowIndex,
      options.maxRows ?? preview.rows.length
    )

    summary = {
      totalRows: preview.rows.length,
      processed: fromRowIndex,
      updatedCount: 0,
      skippedCount: 0,
      failedCount: 0,
      skipped: [],
      failed: [],
    }
    await updatePlusUpdateJobProgress(pool, {
      jobId,
      summary,
    })

    let rowIndex = fromRowIndex
    let aborted = false

    for (const row of rowsToProcess) {
      // Checked before starting a row, not after: a row begun with no budget
      // left would blow the slice on its POS calls alone.
      if (options.deadlineAt !== undefined && Date.now() >= options.deadlineAt) {
        break
      }
      rowIndex += 1
      summary.processed += 1

      if (row.status === "skipped") {
        summary.skippedCount += 1
        summary.skipped.push(createSummaryItem(row, row.reason ?? "Skipped."))
        onProgress({
          type: "progress",
          jobId,
          processed: summary.processed,
          totalRows: summary.totalRows,
          updatedCount: summary.updatedCount,
          skippedCount: summary.skippedCount,
          failedCount: summary.failedCount,
          current: {
            fid: row.fid,
            status: "skipped",
            reason: row.reason,
          },
        })
        await updatePlusUpdateJobProgress(pool, { jobId, summary })
      if (options.onRowComplete) {
        const alive = await options.onRowComplete({
          rowIndex,
          summary,
          phases: null,
          outcome: "skipped",
          fid: row.fid,
        })
        if (!alive) {
          aborted = true
          break
        }
      }
        continue
      }

      const merchantMap = preview.merchantsByFid
      const merchantRecords = merchantMap.get(row.fid) ?? []
      const merchantRecord = merchantRecords[0]
      const categoryMatch = matchCategory(row.newCategoryText)
      const currentState = merchantRecord
        ? getOutletCurrentState(merchantRecord.outletRawPayload)
        : null
      const revalidatedReason = getPreviewReason({
        row: {
          rowNumber: row.rowNumber,
          fid: row.fid,
          tenantName: row.tenantName,
          oldMerchantId: row.oldMerchantId,
          oldCategoryText: row.oldCategoryText,
          newMerchantId: row.newMerchantId,
          newCategoryText: row.newCategoryText,
        },
        duplicateFid: false,
        merchantRecords,
        categoryMatch,
        currentState,
      })

      if (!merchantRecord || revalidatedReason || !categoryMatch.option || !currentState) {
        const reason = revalidatedReason ?? "Unable to load current DB state."
        summary.skippedCount += 1
        summary.skipped.push(createSummaryItem(row, reason))
        onProgress({
          type: "progress",
          jobId,
          processed: summary.processed,
          totalRows: summary.totalRows,
          updatedCount: summary.updatedCount,
          skippedCount: summary.skippedCount,
          failedCount: summary.failedCount,
          current: {
            fid: row.fid,
            status: "skipped",
            reason,
          },
        })
        await updatePlusUpdateJobProgress(pool, { jobId, summary })
      if (options.onRowComplete) {
        const alive = await options.onRowComplete({
          rowIndex,
          summary,
          phases: null,
          outcome: "skipped",
          fid: row.fid,
        })
        if (!alive) {
          aborted = true
          break
        }
      }
        continue
      }

      const nextCategory = categoryMatch.option

      // Each POS write is planned with its pre-image captured BEFORE the call,
      // and recorded independently. The single try/catch this replaces set one
      // `partialFailure` boolean, so a row whose merchant_id landed but whose
      // category failed was reported as a whole-row failure — losing both the
      // fact that half of it is live in POS and the value it replaced.
      const plan = planRowPhases({
        currentMerchantId: currentState.merchantId,
        newMerchantId: row.newMerchantId,
        oldCategoryText: row.oldCategoryText,
        newCategoryText: row.newCategoryText,
        resolvedCategoryId: nextCategory.id,
      })
      const phases: Record<string, PlusPhaseRecord> = {}
      let lastError: string | null = null

      for (const step of plan) {
        try {
          const session = await posSession.get()
          const url =
            step.phase === "merchant_id"
              ? resolvePosMerchantIdApiUrl(
                  `/api/merchant-id/${encodeURIComponent(row.fid)}/${TARGET_OID}`
                )
              : resolvePosCategoryBusinessApiUrl(
                  `/api/category-business/${encodeURIComponent(row.fid)}/${TARGET_OID}`
                )
          const body =
            step.phase === "merchant_id"
              ? { merchant_id: row.newMerchantId }
              : { category_business: nextCategory.id }

          let response = await httpFetch(url, {
            method: "PATCH",
            headers: {
              Accept: "application/json",
              Authorization: `Bearer ${session.token}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify(body),
            label: `plusImport.${step.phase}`,
            timeoutMs: PLUS_POS_TIMEOUT_MS,
            attempts: 2,
            shouldRetry: RETRY_ABSOLUTE_POS_WRITE,
          })

          // A long run can outlive the POS token; re-authenticate once and
          // retry this phase before treating it as a real failure.
          if (response.status === 401) {
            const refreshed = await posSession.refresh()
            response = await httpFetch(url, {
              method: "PATCH",
              headers: {
                Accept: "application/json",
                Authorization: `Bearer ${refreshed.token}`,
                "Content-Type": "application/json",
              },
              body: JSON.stringify(body),
              label: `plusImport.${step.phase}.reauth`,
              timeoutMs: PLUS_POS_TIMEOUT_MS,
              attempts: 1,
            })
          }

          if (!response.ok) {
            const details = await response.text().catch(() => "")
            throw new Error(
              details
                ? `${step.phase} update failed (${redactUrlForLogs(url)}): ${details}`
                : `${step.phase} update failed (${response.status}).`
            )
          }

          phases[step.phase] = {
            state: "applied",
            previous: step.previous,
            next: step.next,
          }
        } catch (error) {
          const message =
            error instanceof Error ? error.message : "Unknown update failure."
          lastError = message
          phases[step.phase] = {
            state: "failed",
            previous: step.previous,
            next: step.next,
            error: message,
          }
          // Deliberately not breaking: the phases are independent, and stopping
          // here would leave a phase that could have succeeded unattempted.
        }
      }

      // One mirror write per row covering every applied phase, in a single
      // transaction. It previously ran once per phase, each doing two
      // un-transacted UPDATEs — a second way for a row to end up half-applied.
      const appliedMerchantId = phases.merchant_id?.state === "applied"
      const appliedCategory = phases.category_business?.state === "applied"
      if (appliedMerchantId || appliedCategory) {
        await syncLocalMerchantCache(pool, merchantRecord, {
          ...(appliedMerchantId ? { merchantId: row.newMerchantId } : {}),
          ...(appliedCategory ? { categoryOption: nextCategory } : {}),
        })
      }

      const outcome = rowOutcome(phases)
      const partialFailure = outcome === "failed" || outcome === "partial"

      if (partialFailure) {
        summary.failedCount += 1
        summary.failed.push(createSummaryItem(row, lastError ?? "Update failed."))
        onProgress({
          type: "progress",
          jobId,
          processed: summary.processed,
          totalRows: summary.totalRows,
          updatedCount: summary.updatedCount,
          skippedCount: summary.skippedCount,
          failedCount: summary.failedCount,
          current: {
            fid: row.fid,
            status: "failed",
            reason: lastError,
          },
        })
        await updatePlusUpdateJobProgress(pool, { jobId, summary })
      if (options.onRowComplete) {
        const alive = await options.onRowComplete({
          rowIndex,
          summary,
          phases: null,
          outcome: "skipped",
          fid: row.fid,
        })
        if (!alive) {
          aborted = true
          break
        }
      }
        continue
      }

      summary.updatedCount += 1
      onProgress({
        type: "progress",
        jobId,
        processed: summary.processed,
        totalRows: summary.totalRows,
        updatedCount: summary.updatedCount,
        skippedCount: summary.skippedCount,
        failedCount: summary.failedCount,
        current: {
          fid: row.fid,
          status: "updated",
          merchantUpdated: appliedMerchantId,
          categoryUpdated: appliedCategory,
        },
      })
      await updatePlusUpdateJobProgress(pool, { jobId, summary })

      if (options.onRowComplete) {
        const alive = await options.onRowComplete({
          rowIndex,
          summary,
          phases,
          outcome,
          fid: row.fid,
        })
        if (!alive) {
          aborted = true
          break
        }
      }
    }

    const done = !aborted && rowIndex >= preview.rows.length

    // Only a run that reached the last row is complete. A slice that yielded on
    // its deadline, or aborted on a lost lease, leaves the row status alone so
    // the runner can resume it.
    if (done) {
      await updatePlusUpdateJob(pool, {
        jobId,
        status: "completed",
        summary,
      })
    }

    return {
      summary,
      fingerprint,
      nextRowIndex: rowIndex,
      totalRows: preview.rows.length,
      done,
      aborted,
    } satisfies PlusSliceResult
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "PLUS update failed."
    await updatePlusUpdateJob(pool, {
      jobId,
      status: "failed",
      summary,
      errorMessage: message,
    })
    throw error
  }
  // No `finally` deleting the upload here, deliberately. It ran on EVERY exit
  // path including the failure one, and the job re-reads that same object to
  // start — so a failed run destroyed its own retry path. Deletion is now the
  // reaper's job, on a retention window measured from the run finishing.
}
