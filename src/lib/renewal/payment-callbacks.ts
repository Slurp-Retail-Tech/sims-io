/**
 * The callback ledger: every notification the gateway sent, verbatim, and
 * what SIMS did with it.
 */

import getPool, { type Queryable } from "../db.ts"
import type { ResultSetHeader, RowDataPacket } from "mysql2/promise"

import type { GatewayNotice } from "./payment-confirmation-rules.ts"

/** Where the gateway posts. Also what a session's `callbackUrl` is built from. */
export const CALLBACK_PATH = "/api/public/commercepay/callback"

export type CallbackOutcome =
  | "accepted"
  | "duplicate"
  | "rejected_signature"
  | "unmatched"
  | "amount_mismatch"
  | "ignored_status"
  | "error"
  | "overpayment"
  | "refunded"

/** Persist the raw body first. Returns the row id for the outcome update. */
export async function recordCallback(
  input: { rawBody: string; presentedSignature: string | null; notice: GatewayNotice | null },
  db: Queryable = getPool()
): Promise<string> {
  const { rawBody, presentedSignature, notice } = input
  const [result] = await db.query<ResultSetHeader>(
    `INSERT INTO renewal_payment_callbacks
       (raw_body, presented_signature, signature_valid, reference_code, cap_session_number,
        cap_transaction_number, gateway_status_code, amount, currency_code)
     VALUES (?, ?, 0, ?, ?, ?, ?, ?, ?)`,
    [
      rawBody.slice(0, 16_000_000),
      presentedSignature ? presentedSignature.slice(0, 128) : null,
      notice?.referenceCode.slice(0, 50) ?? null,
      notice?.paymentSessionNumber?.slice(0, 64) ?? null,
      notice?.transactionNumber?.slice(0, 64) ?? null,
      notice?.status ?? null,
      notice?.amount === null || notice?.amount === undefined ? null : minorToDecimal(notice.amount),
      notice?.currencyCode?.slice(0, 3) ?? null,
    ]
  )
  return String(result.insertId)
}

export async function finishCallbackRecord(
  callbackId: string | null,
  result: { outcome: CallbackOutcome; note: string | null; signatureValid: boolean; sessionId?: string | null },
  db: Queryable = getPool()
): Promise<void> {
  if (!callbackId) {
    return
  }
  await db.query<ResultSetHeader>(
    `UPDATE renewal_payment_callbacks
        SET outcome = ?, note = ?, signature_valid = ?, session_id = ?, processed_at = NOW(3)
      WHERE id = ?`,
    [result.outcome, result.note ? result.note.slice(0, 500) : null, result.signatureValid ? 1 : 0, result.sessionId ?? null, callbackId]
  )
}

export type CallbackRecord = {
  id: string
  receivedAt: string
  referenceCode: string | null
  gatewayStatusCode: number | null
  amountMinor: number | null
  outcome: CallbackOutcome | null
  note: string | null
  signatureValid: boolean
}

/** Callbacks that named one of an invoice's sessions, oldest first. */
export async function listCallbacksForInvoice(
  invoiceId: string,
  db: Queryable = getPool()
): Promise<CallbackRecord[]> {
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT c.id, c.received_at, c.reference_code, c.gateway_status_code, c.amount, c.outcome,
            c.note, c.signature_valid
       FROM renewal_payment_callbacks c
      WHERE c.session_id IN (SELECT id FROM renewal_payment_sessions WHERE invoice_id = ?)
         OR c.reference_code IN (SELECT reference_code FROM renewal_payment_sessions WHERE invoice_id = ?)
      ORDER BY c.id ASC`,
    [invoiceId, invoiceId]
  )
  return (rows as Array<Record<string, unknown>>).map((row) => ({
    id: String(row.id),
    receivedAt: String(row.received_at),
    referenceCode: (row.reference_code as string | null) ?? null,
    gatewayStatusCode: row.gateway_status_code === null ? null : Number(row.gateway_status_code),
    amountMinor: row.amount === null ? null : Math.round(Number(row.amount) * 100),
    outcome: (row.outcome as CallbackOutcome | null) ?? null,
    note: (row.note as string | null) ?? null,
    signatureValid: Number(row.signature_valid) === 1,
  }))
}

function minorToDecimal(minor: number): string {
  const negative = minor < 0 ? "-" : ""
  const absolute = Math.abs(minor)
  return `${negative}${Math.trunc(absolute / 100)}.${String(absolute % 100).padStart(2, "0")}`
}
