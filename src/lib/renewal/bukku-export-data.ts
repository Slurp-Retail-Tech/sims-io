/**
 * The database half of the Bukku export: which paid invoices fall in a
 * period, generating the file, recording the batch, and marking the invoices
 * so the next export leaves them out.
 *
 * The file is stored under `renewal-exports/`, a prefix outside
 * OBJECT_KEY_PREFIXES, so it is reachable only through the exports route.
 */

import getPool, { withTransaction, type Queryable } from "../db.ts"
import type { ResultSetHeader, RowDataPacket } from "mysql2/promise"
import * as XLSX from "xlsx"

import { getObjectBuffer, uploadObject } from "../storage.ts"
import { buildBukkuRows, formatBatchReference } from "./bukku-export.ts"
import type { ExportableLine } from "./bukku-export.ts"
import { loadRenewalSettings } from "./settings.ts"

export type ExportPreview = {
  invoiceCount: number
  lineCount: number
  totalMinor: number
  alreadyExported: number
  totalPaidInPeriod: number
}

export type ExportBatch = {
  id: string
  reference: string
  paidFrom: string
  paidTo: string
  includeExported: boolean
  invoiceCount: number
  lineCount: number
  totalMinor: number
  generatedByUserId: string | null
  createdAt: string
  /** Invoices in this batch voided after export; they need a manual credit in Bukku. */
  voidedAfterExport: number
}

type LineRow = RowDataPacket & {
  invoice_id: string
  invoice_number: string
  paid_at: string | null
  company_name: string | null
  franchise_id: string
  outlet_name: string | null
  outlet_id: string
  plan_name: string | null
  billing_plan: "annually" | "bi_annually"
  previous_valid_until: string | null
  effective_amount: string
  tax_rate: string
  paid_via: string | null
  cap_transaction_number: string | null
  bukku_export_id: string | null
}

async function loadLines(
  paidFrom: string,
  paidTo: string,
  includeExported: boolean,
  db: Queryable
): Promise<LineRow[]> {
  const [rows] = await db.query<LineRow[]>(
    `SELECT i.id AS invoice_id, i.invoice_number, i.paid_at, i.company_name, i.franchise_id,
            t.outlet_name, t.outlet_id, p.plan_name, t.billing_plan, t.previous_valid_until,
            t.effective_amount, i.tax_rate, i.paid_via, i.cap_transaction_number, i.bukku_export_id
       FROM renewal_invoices i
       INNER JOIN renewal_invoice_items t ON t.invoice_id = i.id
       LEFT JOIN subscription_plans p ON p.id = t.plan_id
      WHERE i.deleted_at IS NULL
        AND i.document_type = 'proforma'
        AND i.status = 'paid'
        AND DATE(i.paid_at) BETWEEN ? AND ?
        ${includeExported ? "" : "AND i.bukku_export_id IS NULL"}
      ORDER BY i.paid_at ASC, i.id ASC, t.sort_order ASC`,
    [paidFrom, paidTo]
  )
  return rows
}

function toExportable(row: LineRow): ExportableLine {
  return {
    invoiceNumber: row.invoice_number,
    paidAt: row.paid_at,
    companyName: row.company_name,
    franchiseId: row.franchise_id,
    outletName: row.outlet_name,
    outletId: row.outlet_id,
    planName: row.plan_name,
    billingPlan: row.billing_plan,
    previousValidUntil: row.previous_valid_until,
    effectiveMinor: Math.round(Number(row.effective_amount) * 100),
    taxRatePercent: Number(row.tax_rate),
    paidVia: row.paid_via,
    capTransactionNumber: row.cap_transaction_number,
  }
}

export async function previewExport(
  paidFrom: string,
  paidTo: string,
  includeExported: boolean,
  db: Queryable = getPool()
): Promise<ExportPreview> {
  const [all, selected] = await Promise.all([
    loadLines(paidFrom, paidTo, true, db),
    loadLines(paidFrom, paidTo, includeExported, db),
  ])
  const invoiceIds = new Set(selected.map((row) => row.invoice_id))
  const allInvoiceIds = new Set(all.map((row) => row.invoice_id))
  const exportedIds = new Set(all.filter((row) => row.bukku_export_id).map((row) => row.invoice_id))
  return {
    invoiceCount: invoiceIds.size,
    lineCount: selected.length,
    totalMinor: selected.reduce((sum, row) => sum + Math.round(Number(row.effective_amount) * 100), 0),
    alreadyExported: exportedIds.size,
    totalPaidInPeriod: allInvoiceIds.size,
  }
}

function bucket(): string {
  const value = process.env.MINIO_BUCKET?.trim()
  if (!value) {
    throw new Error("MINIO_BUCKET is not set; cannot store export files.")
  }
  return value
}

/**
 * Generate the file, record the batch, and stamp the invoices.
 *
 * The reference is allocated under a lock on the previous batch row for the
 * month so two people exporting at once cannot mint the same number. The
 * upload happens before the commit; a failed upload leaves no batch behind.
 */
export async function generateExport(
  input: { paidFrom: string; paidTo: string; includeExported: boolean; userId: string },
  db: Queryable = getPool()
): Promise<{ ok: true; batch: ExportBatch } | { ok: false; message: string }> {
  const lines = await loadLines(input.paidFrom, input.paidTo, input.includeExported, db)
  if (lines.length === 0) {
    return { ok: false, message: "No paid invoices in that period are left to export." }
  }

  const settings = await loadRenewalSettings(db)
  const rows = buildBukkuRows(lines.map(toExportable), settings.bukkuDescriptionFormat)
  const csv = XLSX.utils.sheet_to_csv(XLSX.utils.json_to_sheet(rows))
  const invoiceIds = [...new Set(lines.map((row) => row.invoice_id))]
  const totalMinor = lines.reduce((sum, row) => sum + Math.round(Number(row.effective_amount) * 100), 0)

  const batch = await withTransaction(async (connection) => {
    const monthPrefix = `BKX-${input.paidTo.slice(0, 7)}-`
    const [seqRows] = await connection.query<RowDataPacket[]>(
      `SELECT reference FROM renewal_bukku_exports WHERE reference LIKE ? ORDER BY id DESC LIMIT 1 FOR UPDATE`,
      [`${monthPrefix}%`]
    )
    const last = (seqRows[0] as { reference?: string } | undefined)?.reference
    const sequence = last ? Number(last.slice(monthPrefix.length)) + 1 : 1
    const reference = formatBatchReference(input.paidTo, sequence)
    const objectKey = `renewal-exports/${input.paidTo.slice(0, 4)}/${reference}.csv`

    await uploadObject({
      bucket: bucket(),
      key: objectKey,
      body: Buffer.from(csv, "utf8"),
      contentType: "text/csv; charset=utf-8",
    })

    const [result] = await connection.query<ResultSetHeader>(
      `INSERT INTO renewal_bukku_exports
         (reference, paid_from, paid_to, include_exported, invoice_count, line_count,
          total_amount, object_key, generated_by_user_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        reference,
        input.paidFrom,
        input.paidTo,
        input.includeExported ? 1 : 0,
        invoiceIds.length,
        lines.length,
        (totalMinor / 100).toFixed(2),
        objectKey,
        input.userId,
      ]
    )
    const batchId = String(result.insertId)

    await connection.query<ResultSetHeader>(
      `UPDATE renewal_invoices SET bukku_export_id = ?, bukku_exported_at = NOW(3)
        WHERE id IN (${invoiceIds.map(() => "?").join(", ")})`,
      [batchId, ...invoiceIds]
    )

    return {
      id: batchId,
      reference,
      paidFrom: input.paidFrom,
      paidTo: input.paidTo,
      includeExported: input.includeExported,
      invoiceCount: invoiceIds.length,
      lineCount: lines.length,
      totalMinor,
      generatedByUserId: input.userId,
      createdAt: new Date().toISOString(),
      voidedAfterExport: 0,
    } satisfies ExportBatch
  })

  return { ok: true, batch }
}

export async function listExportBatches(db: Queryable = getPool()): Promise<ExportBatch[]> {
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT b.id, b.reference, b.paid_from, b.paid_to, b.include_exported, b.invoice_count,
            b.line_count, b.total_amount, b.generated_by_user_id, b.created_at,
            (SELECT COUNT(*) FROM renewal_invoices i
              WHERE i.bukku_export_id = b.id AND i.status = 'cancelled') AS voided
       FROM renewal_bukku_exports b
      ORDER BY b.id DESC LIMIT 50`
  )
  return (rows as Array<Record<string, string | number | null>>).map((row) => ({
    id: String(row.id),
    reference: String(row.reference),
    paidFrom: String(row.paid_from),
    paidTo: String(row.paid_to),
    includeExported: Number(row.include_exported) === 1,
    invoiceCount: Number(row.invoice_count),
    lineCount: Number(row.line_count),
    totalMinor: Math.round(Number(row.total_amount) * 100),
    generatedByUserId: row.generated_by_user_id === null ? null : String(row.generated_by_user_id),
    createdAt: String(row.created_at),
    voidedAfterExport: Number(row.voided ?? 0),
  }))
}

export async function loadExportFile(
  batchId: string,
  db: Queryable = getPool()
): Promise<{ bytes: Buffer; fileName: string } | null> {
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT reference, object_key FROM renewal_bukku_exports WHERE id = ?`,
    [batchId]
  )
  const row = rows[0] as { reference?: string; object_key?: string | null } | undefined
  if (!row?.object_key) {
    return null
  }
  const bytes = await getObjectBuffer(bucket(), row.object_key)
  return { bytes, fileName: `${row.reference}.csv` }
}
