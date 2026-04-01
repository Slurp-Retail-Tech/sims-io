import type { Pool, ResultSetHeader, RowDataPacket } from "mysql2/promise"

import getPool from "@/lib/db"
import {
  authenticatePosApiSession,
  fetchPosApiWithSessionInit,
  getPosApiItems,
  resolvePosCategoryBusinessApiUrl,
  resolvePosMerchantIdApiUrl,
  resolvePosApiUrl,
} from "@/lib/pos-api"
import { readWorkbookRows } from "@/lib/spreadsheet"
import { deleteObject, getObjectBuffer } from "@/lib/storage"

const TARGET_OID = "1"
const DATA_START_ROW_INDEX = 3

type JsonRecord = Record<string, unknown>

type ParsedTemplateRow = {
  rowNumber: number
  tenantName: string
  fid: string
  oldMerchantId: string
  oldCategoryText: string
  newMerchantId: string
  newCategoryText: string
}

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

async function parseTemplateRows(buffer: Buffer) {
  const rows = await readWorkbookRows(buffer)

  return rows
    .slice(DATA_START_ROW_INDEX)
    .map((row, index) => {
      const fid = String(row[4] ?? "").trim()
      const oldMerchantId = String(row[6] ?? "").trim()
      const oldCategoryText = String(row[9] ?? "").trim()
      const newMerchantId = String(row[10] ?? "").trim()
      const newCategoryText = String(row[13] ?? "").trim()
      const tenantName = String(row[3] ?? "").trim()

      return {
        rowNumber: DATA_START_ROW_INDEX + index + 1,
        tenantName,
        fid,
        oldMerchantId,
        oldCategoryText,
        newMerchantId,
        newCategoryText,
      } satisfies ParsedTemplateRow
    })
    .filter((row) => {
      return (
        row.fid ||
        row.oldMerchantId ||
        row.oldCategoryText ||
        row.newMerchantId ||
        row.newCategoryText ||
        row.tenantName
      )
    })
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
  const bucket = process.env.MINIO_BUCKET
  if (!bucket) {
    throw new Error("Storage is not configured.")
  }

  const buffer = await getObjectBuffer(bucket, key)
  return buildPreviewFromBuffer(buffer, categories)
}

async function buildPreviewFromBuffer(
  buffer: Buffer,
  categories: CategoryBusinessOption[]
) {
  const rows = await parseTemplateRows(buffer)
  const uniqueFids = Array.from(new Set(rows.map((row) => row.fid).filter(Boolean)))
  const duplicates = new Set<string>()
  const seen = new Set<string>()
  for (const row of rows) {
    if (!row.fid) {
      continue
    }
    if (seen.has(row.fid)) {
      duplicates.add(row.fid)
      continue
    }
    seen.add(row.fid)
  }

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

export async function cleanupPlusUpload(key: string) {
  const bucket = process.env.MINIO_BUCKET
  if (!bucket) {
    throw new Error("Storage is not configured.")
  }
  await deleteObject(bucket, key)
}

async function ensurePlusUpdateJobsTable(pool: Pool) {
  await pool.query(
    `
    CREATE TABLE IF NOT EXISTS plus_update_jobs (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      status ENUM('running', 'completed', 'failed') NOT NULL DEFAULT 'running',
      requested_by VARCHAR(255) DEFAULT NULL,
      upload_key VARCHAR(512) DEFAULT NULL,
      total_rows INT NOT NULL DEFAULT 0,
      processed_rows INT NOT NULL DEFAULT 0,
      updated_count INT NOT NULL DEFAULT 0,
      skipped_count INT NOT NULL DEFAULT 0,
      failed_count INT NOT NULL DEFAULT 0,
      summary_json JSON DEFAULT NULL,
      error_message TEXT DEFAULT NULL,
      started_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      finished_at DATETIME(3) DEFAULT NULL,
      INDEX plus_update_jobs_status_started_idx (status, started_at)
    )
  `
  )
}

export async function createPlusUpdateJob(
  pool: Pool,
  input: { requestedBy: string | null; uploadKey: string }
) {
  await ensurePlusUpdateJobsTable(pool)
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
  await ensurePlusUpdateJobsTable(pool)
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

export async function runPlusUpdate(
  key: string,
  onProgress: (event: Record<string, unknown>) => void,
  input?: { requestedBy?: string | null }
) {
  const pool = getPool()
  const jobId = await createPlusUpdateJob(pool, {
    requestedBy: input?.requestedBy ?? null,
    uploadKey: key,
  })
  return runPlusUpdateJob(jobId, onProgress)
}

export async function runPlusUpdateJob(
  jobId: string,
  onProgress: (event: Record<string, unknown>) => void = () => undefined
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
    const session = await authenticatePosApiSession()
    const categories = await fetchCategoryBusinessOptionsWithSession(session)
    const preview = await buildPreviewFromTemplate(job.uploadKey, categories)
    const matchCategory = createCategoryMatcher(categories)

    summary = {
      totalRows: preview.rows.length,
      processed: 0,
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

    for (const row of preview.rows) {
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
        continue
      }

      const merchantMap = await loadMerchantSourceRecords(pool, [row.fid])
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
        continue
      }

      const nextCategory = categoryMatch.option
      const merchantNeedsUpdate =
        normalizeText(currentState.merchantId) !== normalizeText(row.newMerchantId)
      const categoryNeedsUpdate =
        normalizeText(row.oldCategoryText) !== normalizeText(row.newCategoryText)
      let partialFailure = false
      let lastError: string | null = null

      try {
        if (merchantNeedsUpdate) {
          const merchantIdUrl = resolvePosMerchantIdApiUrl(
            `/api/merchant-id/${encodeURIComponent(row.fid)}/${TARGET_OID}`
          )
          const response = await fetch(merchantIdUrl, {
            method: "PATCH",
            headers: {
              Accept: "application/json",
              Authorization: `Bearer ${session.token}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ merchant_id: row.newMerchantId }),
          })
          if (!response.ok) {
            const details = await response.text().catch(() => "")
            throw new Error(
              details
                ? `merchant_id update failed (${merchantIdUrl}): ${details}`
                : `merchant_id update failed (${response.status}).`
            )
          }
          await syncLocalMerchantCache(pool, merchantRecord, {
            merchantId: row.newMerchantId,
          })
        }

        if (categoryNeedsUpdate) {
          const categoryBusinessUrl = resolvePosCategoryBusinessApiUrl(
            `/api/category-business/${encodeURIComponent(row.fid)}/${TARGET_OID}`
          )
          const response = await fetch(categoryBusinessUrl, {
            method: "PATCH",
            headers: {
              Accept: "application/json",
              Authorization: `Bearer ${session.token}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ category_business: nextCategory.id }),
          })
          if (!response.ok) {
            const details = await response.text().catch(() => "")
            throw new Error(
              details
                ? `category_business update failed (${categoryBusinessUrl}): ${details}`
                : `category_business update failed (${response.status}).`
            )
          }
          await syncLocalMerchantCache(pool, merchantRecord, {
            categoryOption: nextCategory,
          })
        }
      } catch (error) {
        partialFailure = true
        lastError =
          error instanceof Error ? error.message : "Unknown update failure."
      }

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
          merchantUpdated: merchantNeedsUpdate,
          categoryUpdated: categoryNeedsUpdate,
        },
      })
      await updatePlusUpdateJobProgress(pool, { jobId, summary })
    }

    await updatePlusUpdateJob(pool, {
      jobId,
      status: "completed",
      summary,
    })

    return summary
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
  } finally {
    await cleanupPlusUpload(job.uploadKey).catch((error) => {
      console.error("PLUS upload cleanup failed:", error)
    })
  }
}
