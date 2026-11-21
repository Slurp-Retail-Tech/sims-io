/**
 * Proof of payment attached to a renewal paid outside the gateway: the bank
 * slip, transfer screenshot or remittance advice the merchant sent.
 *
 * Stored under `renewal-payment-proofs/`, outside OBJECT_KEY_PREFIXES, so the
 * generic upload proxy refuses the keys and the files are reachable only
 * through the invoice's proofs route. Types are sniffed from the bytes, never
 * trusted from the name, and limited to images and PDFs.
 */

import { randomUUID } from "node:crypto"

import getPool, { type Queryable } from "../db.ts"
import type { ResultSetHeader, RowDataPacket } from "mysql2/promise"

import { getObjectBuffer, uploadObject } from "../storage.ts"
import { sniffUploadType } from "../upload-types.ts"
import { recordEvent } from "./invoices.ts"

export const PAYMENT_PROOF_PREFIX = "renewal-payment-proofs"
export const MAX_PROOF_BYTES = 10 * 1024 * 1024
export const MAX_PROOFS_PER_UPLOAD = 5

/** What staff can attach: what a bank app or a scanner produces. */
const ALLOWED_MIMES = new Set(["image/jpeg", "image/png", "image/webp", "image/heic", "application/pdf"])

export const PROOF_ACCEPT = ".jpg,.jpeg,.png,.webp,.heic,.pdf,image/jpeg,image/png,image/webp,image/heic,application/pdf"

export type PaymentProof = {
  id: string
  invoiceId: string
  originalName: string
  contentType: string
  sizeBytes: number
  uploadedByUserId: string | null
  uploadedAt: string
}

export type ProofFile = { name: string; bytes: Buffer }

export type ProofUploadOutcome =
  | { ok: true; proofs: PaymentProof[] }
  | { ok: false; status: number; message: string }

function bucket(): string {
  const value = process.env.MINIO_BUCKET?.trim()
  if (!value) {
    throw new Error("MINIO_BUCKET is not set; cannot store payment proofs.")
  }
  return value
}

/** A display name safe to send back in a Content-Disposition header. */
export function safeFileName(name: string): string {
  const cleaned = name.replace(/[\\/\r\n"]/g, "_").replace(/[^\x20-\x7e]/g, "_").trim()
  return (cleaned || "proof").slice(0, 120)
}

/**
 * Check every file before storing any, so a bad third file does not leave
 * the first two attached and the person unsure what went through.
 */
export function validateProofFiles(
  files: readonly ProofFile[]
): { ok: true; types: Array<{ mime: string; extension: string }> } | { ok: false; message: string } {
  if (files.length === 0) {
    return { ok: false, message: "Choose at least one file." }
  }
  if (files.length > MAX_PROOFS_PER_UPLOAD) {
    return { ok: false, message: `Attach at most ${MAX_PROOFS_PER_UPLOAD} files at a time.` }
  }
  const types: Array<{ mime: string; extension: string }> = []
  for (const file of files) {
    if (file.bytes.byteLength === 0) {
      return { ok: false, message: `${file.name} is empty.` }
    }
    if (file.bytes.byteLength > MAX_PROOF_BYTES) {
      return { ok: false, message: `${file.name} is over 10 MB.` }
    }
    const sniffed = sniffUploadType(file.bytes, file.name)
    if (!sniffed || !ALLOWED_MIMES.has(sniffed.mime)) {
      return { ok: false, message: `${file.name} is not an image or PDF.` }
    }
    types.push(sniffed)
  }
  return { ok: true, types }
}

function mapProof(row: RowDataPacket): PaymentProof {
  return {
    id: String(row.id),
    invoiceId: String(row.invoice_id),
    originalName: String(row.original_name),
    contentType: String(row.content_type),
    sizeBytes: Number(row.size_bytes),
    uploadedByUserId: row.uploaded_by_user_id === null ? null : String(row.uploaded_by_user_id),
    uploadedAt: String(row.uploaded_at),
  }
}

export async function listPaymentProofs(invoiceId: string, db: Queryable = getPool()): Promise<PaymentProof[]> {
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT id, invoice_id, original_name, content_type, size_bytes, uploaded_by_user_id, uploaded_at
       FROM renewal_payment_proofs
      WHERE invoice_id = ? AND deleted_at IS NULL
      ORDER BY id ASC`,
    [invoiceId]
  )
  return rows.map(mapProof)
}

/** Proof counts per invoice, for the list's "No proof" flag. */
export async function countPaymentProofs(invoiceIds: readonly string[], db: Queryable = getPool()): Promise<Map<string, number>> {
  if (invoiceIds.length === 0) {
    return new Map()
  }
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT invoice_id, COUNT(*) AS proofs FROM renewal_payment_proofs
      WHERE deleted_at IS NULL AND invoice_id IN (${invoiceIds.map(() => "?").join(", ")})
      GROUP BY invoice_id`,
    [...invoiceIds]
  )
  return new Map(rows.map((row) => [String(row.invoice_id), Number(row.proofs)]))
}

/**
 * Attach files to a proforma. Allowed at any point after it exists, because
 * a merchant often sends the slip a day after the transfer is recorded.
 */
export async function attachPaymentProofs(
  invoiceId: string,
  files: readonly ProofFile[],
  actorUserId: string,
  db: Queryable = getPool()
): Promise<ProofUploadOutcome> {
  const [invoiceRows] = await db.query<RowDataPacket[]>(
    `SELECT document_type, issue_date FROM renewal_invoices WHERE id = ? AND deleted_at IS NULL`,
    [invoiceId]
  )
  const invoice = invoiceRows[0] as { document_type?: string; issue_date?: string | null } | undefined
  if (!invoice) {
    return { ok: false, status: 404, message: "Invoice not found." }
  }
  if (invoice.document_type !== "proforma") {
    return { ok: false, status: 409, message: "Attach proof of payment to the proforma, not its tax invoice." }
  }
  const checked = validateProofFiles(files)
  if (!checked.ok) {
    return { ok: false, status: 400, message: checked.message }
  }

  const year = new Date().getUTCFullYear()
  const ids: string[] = []
  for (const [index, file] of files.entries()) {
    const type = checked.types[index]
    const objectKey = `${PAYMENT_PROOF_PREFIX}/${year}/${invoiceId}/${randomUUID()}.${type.extension}`
    await uploadObject({ bucket: bucket(), key: objectKey, body: file.bytes, contentType: type.mime })
    const [result] = await db.query<ResultSetHeader>(
      `INSERT INTO renewal_payment_proofs
         (invoice_id, object_key, original_name, content_type, size_bytes, uploaded_by_user_id)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [invoiceId, objectKey, safeFileName(file.name), type.mime, file.bytes.byteLength, actorUserId]
    )
    ids.push(String(result.insertId))
  }
  await recordEvent(db, invoiceId, "payment_proof_attached", actorUserId, {
    files: files.map((file) => safeFileName(file.name)),
  })

  const proofs = (await listPaymentProofs(invoiceId, db)).filter((proof) => ids.includes(proof.id))
  return { ok: true, proofs }
}

/** The file's bytes, for the invoice's proofs route. Null when it is gone or on another invoice. */
export async function loadPaymentProof(
  invoiceId: string,
  proofId: string,
  db: Queryable = getPool()
): Promise<{ bytes: Buffer; contentType: string; fileName: string } | null> {
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT object_key, original_name, content_type FROM renewal_payment_proofs
      WHERE id = ? AND invoice_id = ? AND deleted_at IS NULL`,
    [proofId, invoiceId]
  )
  const row = rows[0] as { object_key?: string; original_name?: string; content_type?: string } | undefined
  if (!row?.object_key) {
    return null
  }
  const bytes = await getObjectBuffer(bucket(), row.object_key)
  return {
    bytes: Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes),
    contentType: row.content_type ?? "application/octet-stream",
    fileName: safeFileName(row.original_name ?? "proof"),
  }
}

/** Detach a file attached by mistake. The row and the object stay, for the audit trail. */
export async function removePaymentProof(
  invoiceId: string,
  proofId: string,
  actorUserId: string,
  db: Queryable = getPool()
): Promise<boolean> {
  const [result] = await db.query<ResultSetHeader>(
    `UPDATE renewal_payment_proofs SET deleted_at = NOW(3), deleted_by_user_id = ?
      WHERE id = ? AND invoice_id = ? AND deleted_at IS NULL`,
    [actorUserId, proofId, invoiceId]
  )
  if (result.affectedRows === 0) {
    return false
  }
  await recordEvent(db, invoiceId, "payment_proof_removed", actorUserId, { proofId })
  return true
}
