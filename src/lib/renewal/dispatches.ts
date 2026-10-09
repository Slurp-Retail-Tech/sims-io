/**
 * The database side of renewal dispatch: writing, claiming and settling
 * `renewal_dispatches` rows. Every decision is in `dispatch-plan.ts`.
 *
 * A row is claimed by stamping the attempt *before* the Respond.io call, so
 * an interrupted send leaves a row whose last attempt is later than when it
 * was due. Such a row is never retried automatically, because the message
 * may well have been delivered; after a quarter of an hour it is marked
 * failed with an explanation, and a person uses Resend if it did not arrive.
 */

import getPool, { type Queryable } from "../db.ts"
import type { ResultSetHeader, RowDataPacket } from "mysql2/promise"

import { raiseAction, resolveActionsForInvoice } from "./actions-required.ts"
import type { DispatchType, PlannedDispatch } from "./dispatch-plan.ts"
import { REMINDER_TYPES } from "./dispatch-plan.ts"
import type { Channel } from "./pic-resolution.ts"

export type DispatchStatus = "queued" | "sent" | "failed" | "suppressed" | "cancelled"

export type DispatchRecord = {
  id: string
  invoiceId: string
  dispatchType: DispatchType
  channel: Channel
  recipientKey: string
  contactId: string | null
  recipientRole: "pic" | "cc"
  recipientName: string | null
  address: string
  status: DispatchStatus
  statusNote: string | null
  attempts: number
  nextAttemptAt: string
  lastAttemptAt: string | null
  respondioMessageId: string | null
  sentAt: string | null
  createdAt: string
}

type DispatchRow = RowDataPacket & {
  id: string
  invoice_id: string
  dispatch_type: DispatchType
  channel: Channel
  recipient_key: string
  contact_id: string | null
  recipient_role: "pic" | "cc"
  recipient_name: string | null
  address: string
  status: DispatchStatus
  status_note: string | null
  attempts: number
  next_attempt_at: string
  last_attempt_at: string | null
  respondio_message_id: string | null
  sent_at: string | null
  created_at: string
}

const SELECT = `SELECT id, invoice_id, dispatch_type, channel, recipient_key, contact_id, recipient_role,
                       recipient_name, address, status, status_note, attempts, next_attempt_at,
                       last_attempt_at, respondio_message_id, sent_at, created_at
                  FROM renewal_dispatches`

/**
 * Write planned rows. A row that already exists for the same invoice, type,
 * channel and recipient is left alone, which is what makes re-running a night
 * safe. Returns how many were new.
 */
export async function enqueueDispatches(
  invoiceId: string,
  planned: readonly PlannedDispatch[],
  requestedByUserId: string | null = null,
  db: Queryable = getPool()
): Promise<number> {
  let inserted = 0
  for (const row of planned) {
    const [result] = await db.query<ResultSetHeader>(
      `INSERT IGNORE INTO renewal_dispatches
         (invoice_id, dispatch_type, channel, recipient_key, contact_id, recipient_role,
          recipient_name, address, status, status_note, requested_by_user_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        invoiceId,
        row.dispatchType,
        row.channel,
        row.recipientKey,
        row.contactId,
        row.recipientRole,
        row.recipientName,
        row.address,
        row.status,
        row.statusNote,
        requestedByUserId,
      ]
    )
    inserted += result.affectedRows
  }
  return inserted
}

/** Queued rows that are due and not already mid-send. */
export async function findDueDispatches(limit: number, db: Queryable = getPool()): Promise<DispatchRecord[]> {
  const [rows] = await db.query<DispatchRow[]>(
    `${SELECT}
      WHERE status = 'queued' AND next_attempt_at <= NOW(3)
        AND (last_attempt_at IS NULL OR last_attempt_at < next_attempt_at)
      ORDER BY next_attempt_at ASC, id ASC
      LIMIT ${Math.max(1, Math.floor(limit))}`
  )
  return rows.map(mapRow)
}

/** Whether anything is queued at all, due now or later. */
export async function hasQueuedDispatches(db: Queryable = getPool()): Promise<boolean> {
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT 1 FROM renewal_dispatches WHERE status = 'queued' AND next_attempt_at <= NOW(3) LIMIT 1`
  )
  return rows.length > 0
}

/** Stamp the attempt before the call. False when another worker got there first. */
export async function beginAttempt(id: string, db: Queryable = getPool()): Promise<boolean> {
  const [result] = await db.query<ResultSetHeader>(
    `UPDATE renewal_dispatches
        SET attempts = attempts + 1, last_attempt_at = NOW(3)
      WHERE id = ? AND status = 'queued'
        AND (last_attempt_at IS NULL OR last_attempt_at < next_attempt_at)`,
    [id]
  )
  return result.affectedRows === 1
}

export async function markSent(id: string, messageId: string | null, db: Queryable = getPool()): Promise<void> {
  await db.query(
    `UPDATE renewal_dispatches
        SET status = 'sent', sent_at = NOW(3), respondio_message_id = ?, status_note = NULL
      WHERE id = ?`,
    [messageId, id]
  )
}

/** Try again later. `refundAttempt` for a rate limit, which is not the message's fault. */
export async function retryLater(
  id: string,
  delayMs: number,
  note: string,
  options: { refundAttempt?: boolean } = {},
  db: Queryable = getPool()
): Promise<void> {
  await db.query(
    `UPDATE renewal_dispatches
        SET next_attempt_at = DATE_ADD(NOW(3), INTERVAL ? MICROSECOND),
            status_note = ?,
            attempts = IF(?, GREATEST(attempts, 1) - 1, attempts)
      WHERE id = ?`,
    [Math.max(0, Math.round(delayMs)) * 1000, note.slice(0, 500), options.refundAttempt ? 1 : 0, id]
  )
}

/** Hold a reminder for the send window without spending an attempt. */
export async function deferUntil(id: string, at: Date, db: Queryable = getPool()): Promise<void> {
  await db.query(`UPDATE renewal_dispatches SET next_attempt_at = ? WHERE id = ?`, [toMysql(at), id])
}

export async function closeDispatch(
  id: string,
  status: "failed" | "cancelled",
  note: string,
  db: Queryable = getPool()
): Promise<void> {
  await db.query(`UPDATE renewal_dispatches SET status = ?, status_note = ? WHERE id = ?`, [status, note.slice(0, 500), id])
}

/**
 * Rows claimed and never settled: the worker died mid-send. Marked failed,
 * never resent automatically, since the message may have gone.
 */
export async function failInterruptedDispatches(db: Queryable = getPool()): Promise<string[]> {
  const [rows] = await db.query<Array<RowDataPacket & { id: string; invoice_id: string }>>(
    `SELECT id, invoice_id FROM renewal_dispatches
      WHERE status = 'queued' AND last_attempt_at IS NOT NULL
        AND last_attempt_at >= next_attempt_at
        AND last_attempt_at < DATE_SUB(NOW(3), INTERVAL 15 MINUTE)`
  )
  for (const row of rows) {
    await closeDispatch(
      String(row.id),
      "failed",
      "The send was interrupted and its outcome is unknown. Use Resend if it did not arrive.",
      db
    )
  }
  return rows.map((row) => String(row.invoice_id))
}

export async function listDispatchesForInvoice(invoiceId: string, db: Queryable = getPool()): Promise<DispatchRecord[]> {
  const [rows] = await db.query<DispatchRow[]>(`${SELECT} WHERE invoice_id = ? ORDER BY created_at ASC, id ASC`, [invoiceId])
  return rows.map(mapRow)
}

/** Invoices, of those given, with at least one reminder actually sent. */
export async function invoicesWithSentReminder(
  invoiceIds: readonly string[],
  db: Queryable = getPool()
): Promise<Set<string>> {
  if (invoiceIds.length === 0) {
    return new Set()
  }
  const [rows] = await db.query<Array<RowDataPacket & { invoice_id: string }>>(
    `SELECT DISTINCT invoice_id FROM renewal_dispatches
      WHERE status = 'sent' AND dispatch_type IN (?) AND invoice_id IN (?)`,
    [REMINDER_TYPES, invoiceIds]
  )
  return new Set(rows.map((row) => String(row.invoice_id)))
}

/**
 * Put the latest message on an invoice back in the queue for everyone it
 * went to: "Resend dispatch" on the invoice page. Suppressed rows stay
 * suppressed. Returns how many rows were re-queued.
 */
export async function requeueLatestDispatch(
  invoiceId: string,
  requestedByUserId: string,
  db: Queryable = getPool()
): Promise<{ dispatchType: DispatchType | null; requeued: number }> {
  const [latest] = await db.query<Array<RowDataPacket & { dispatch_type: DispatchType }>>(
    `SELECT dispatch_type FROM renewal_dispatches
      WHERE invoice_id = ? AND status <> 'suppressed'
      ORDER BY created_at DESC, id DESC LIMIT 1`,
    [invoiceId]
  )
  const dispatchType = latest[0]?.dispatch_type ?? null
  if (!dispatchType) {
    return { dispatchType: null, requeued: 0 }
  }
  const [result] = await db.query<ResultSetHeader>(
    `UPDATE renewal_dispatches
        SET status = 'queued', attempts = 0, next_attempt_at = NOW(3), last_attempt_at = NULL,
            status_note = 'Resent by staff', requested_by_user_id = ?
      WHERE invoice_id = ? AND dispatch_type = ? AND status IN ('sent', 'failed', 'cancelled')`,
    [requestedByUserId, invoiceId, dispatchType]
  )
  return { dispatchType, requeued: result.affectedRows }
}

/** Raise `dispatch_failed` for an invoice whose message gave up. */
export async function raiseDispatchFailed(
  invoice: { id: string; franchiseId: string; singleOutletId: string | null },
  detail: string,
  db: Queryable = getPool()
): Promise<void> {
  await raiseAction(
    {
      franchiseId: invoice.franchiseId,
      outletId: invoice.singleOutletId,
      invoiceId: invoice.id,
      reason: "dispatch_failed",
      detail,
    },
    db
  )
}

/** Clear `dispatch_failed` once nothing on the invoice is failed any more. */
export async function resolveDispatchFailedIfClear(invoiceId: string, db: Queryable = getPool()): Promise<void> {
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT 1 FROM renewal_dispatches WHERE invoice_id = ? AND status = 'failed' LIMIT 1`,
    [invoiceId]
  )
  if (rows.length === 0) {
    await resolveActionsForInvoice(invoiceId, ["dispatch_failed"], db)
  }
}

function mapRow(row: DispatchRow): DispatchRecord {
  return {
    id: String(row.id),
    invoiceId: String(row.invoice_id),
    dispatchType: row.dispatch_type,
    channel: row.channel,
    recipientKey: row.recipient_key,
    contactId: row.contact_id === null ? null : String(row.contact_id),
    recipientRole: row.recipient_role,
    recipientName: row.recipient_name,
    address: row.address,
    status: row.status,
    statusNote: row.status_note,
    attempts: Number(row.attempts),
    nextAttemptAt: row.next_attempt_at,
    lastAttemptAt: row.last_attempt_at,
    respondioMessageId: row.respondio_message_id,
    sentAt: row.sent_at,
    createdAt: row.created_at,
  }
}

function toMysql(value: Date): string {
  return value.toISOString().replace("T", " ").replace("Z", "")
}
