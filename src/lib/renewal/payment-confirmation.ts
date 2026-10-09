/**
 * Marking an invoice paid, from whichever direction the news arrives.
 *
 * Three callers: the signed CommercePay callback, the hourly Query sweep
 * that catches a callback that never landed, and a staff member recording a
 * bank transfer. All three end in `confirmPayment`, one transaction that
 * settles the session and the invoice together and hands the rest to the
 * post-payment job. Nothing else in the codebase writes `status = 'paid'`.
 *
 * The decision of what a gateway notice means is in
 * `payment-confirmation-rules.ts`, pure and tested. This file only loads the
 * facts, applies the decision, and records what it did.
 */

import getPool, { withTransaction, type Queryable } from "../db.ts"
import type { ResultSetHeader, RowDataPacket } from "mysql2/promise"

import { enqueueJobRun } from "../job-runner.ts"
import { RENEWAL_POST_PAYMENT_JOB_TYPE } from "../job-types.ts"
import { createLogger } from "../logger.ts"
import { raiseAction } from "./actions-required.ts"
import { getInvoiceById, recordEvent, setInvoiceStatus } from "./invoices.ts"
import { decidePayment } from "./payment-confirmation-rules.ts"
import type { GatewayNotice } from "./payment-confirmation-rules.ts"
import { findLiveSession, findSessionByReference } from "./payment-sessions.ts"

const log = createLogger("renewal:payment-confirmation")

export type ConfirmPaymentInput = {
  invoiceId: string
  /** The session the money landed on; null for a payment recorded by staff. */
  sessionId: string | null
  paidVia: "commercepay" | "manual"
  capTransactionNumber: string | null
  gatewayStatusCode: number | null
  /** Bank reference or note for an offline payment. */
  paidReference: string | null
  actorUserId: string | null
  source: "callback" | "sweep" | "manual"
}

export type ConfirmPaymentOutcome =
  | { ok: true; alreadyPaid: boolean }
  | { ok: false; status: number; message: string }

/**
 * Settle the invoice.
 *
 * Locks the invoice row so two notices about the same payment (the callback
 * and the sweep, say) serialise: the second sees `paid` and leaves. Every
 * open session other than the one that paid is superseded, because the
 * gateway may still let a stale tab through and that money would have no
 * home. The downstream steps are flagged `pending` here and carried out by
 * the post-payment job, never inside this transaction: a storage or POS
 * outage must not roll back the fact that the merchant paid.
 */
export async function confirmPayment(input: ConfirmPaymentInput): Promise<ConfirmPaymentOutcome> {
  const outcome = await withTransaction(async (connection) => {
    const [rows] = await connection.query<RowDataPacket[]>(
      `SELECT id, status, payment_email FROM renewal_invoices
        WHERE id = ? AND deleted_at IS NULL FOR UPDATE`,
      [input.invoiceId]
    )
    const row = rows[0] as { id: string; status: string; payment_email: string | null } | undefined
    if (!row) {
      return { ok: false as const, status: 404, message: "Invoice not found." }
    }
    if (row.status === "paid") {
      return { ok: true as const, alreadyPaid: true }
    }
    if (row.status === "cancelled" || row.status === "superseded") {
      return { ok: false as const, status: 409, message: "This invoice is closed and cannot take a payment." }
    }

    if (input.sessionId) {
      await connection.query<ResultSetHeader>(
        `UPDATE renewal_payment_sessions
            SET status = 'paid', paid_at = COALESCE(paid_at, NOW(3)),
                cap_transaction_number = COALESCE(?, cap_transaction_number),
                gateway_status_code = COALESCE(?, gateway_status_code)
          WHERE id = ?`,
        [input.capTransactionNumber, input.gatewayStatusCode, input.sessionId]
      )
    }
    await connection.query<ResultSetHeader>(
      `UPDATE renewal_payment_sessions
          SET status = 'superseded'
        WHERE invoice_id = ? AND status IN ('created', 'payment_pending')
          AND (? IS NULL OR id <> ?)`,
      [input.invoiceId, input.sessionId, input.sessionId]
    )

    await connection.query<ResultSetHeader>(
      `UPDATE renewal_invoices
          SET status = 'paid', paid_at = NOW(3), paid_via = ?,
              cap_transaction_number = ?, paid_session_id = ?, paid_reference = ?,
              extension_status = 'pending', pos_push_status = 'pending',
              payer_email_status = IF(payment_email IS NULL, 'not_applicable', 'pending'),
              term_locked_at = COALESCE(term_locked_at, NOW(3))
        WHERE id = ?`,
      [
        input.paidVia,
        input.capTransactionNumber,
        input.sessionId,
        input.paidReference,
        input.invoiceId,
      ]
    )
    await recordEvent(connection, input.invoiceId, "status_paid", input.actorUserId, {
      reason:
        input.source === "manual"
          ? "Payment recorded by staff"
          : input.source === "sweep"
            ? "Payment found by the hourly gateway query"
            : "Payment confirmed by the gateway callback",
    })
    await recordEvent(connection, input.invoiceId, "payment_confirmed", input.actorUserId, {
      source: input.source,
      sessionId: input.sessionId,
      paidVia: input.paidVia,
      capTransactionNumber: input.capTransactionNumber,
      reference: input.paidReference,
      reconciledBySweep: input.source === "sweep",
    })
    return { ok: true as const, alreadyPaid: false }
  })

  if (outcome.ok && !outcome.alreadyPaid) {
    await enqueuePostPayment(input.invoiceId, input.actorUserId)
  }
  return outcome
}

/**
 * Queue the post-payment work for an invoice. One run per invoice at a time:
 * the dedupe key makes a second request join the run already queued.
 */
export async function enqueuePostPayment(
  invoiceId: string,
  requestedBy: string | null = null,
  db: Queryable = getPool()
): Promise<{ jobRunId: string; created: boolean }> {
  return enqueueJobRun(db, {
    jobType: RENEWAL_POST_PAYMENT_JOB_TYPE,
    dedupeKey: `invoice:${invoiceId}`,
    triggerSource: requestedBy ? "manual" : "api",
    requestedBy,
    params: { invoiceId },
  })
}

export type NoticeOutcome = {
  outcome:
    | "accepted"
    | "duplicate"
    | "unmatched"
    | "amount_mismatch"
    | "ignored_status"
    | "overpayment"
    | "refunded"
  note: string | null
  sessionId: string | null
  invoiceId: string | null
}

/**
 * Apply a gateway notice whose signature has already been verified (or that
 * came from SIMS's own Query call, which needs no verification).
 */
export async function processGatewayNotice(
  notice: GatewayNotice,
  source: "callback" | "sweep"
): Promise<NoticeOutcome> {
  const session = await findSessionByReference(notice.referenceCode)
  if (!session) {
    return { outcome: "unmatched", note: `No session with reference ${notice.referenceCode}`, sessionId: null, invoiceId: null }
  }
  const invoice = await getInvoiceById(session.invoiceId)
  if (!invoice) {
    return { outcome: "unmatched", note: `Session ${session.id} points at a missing invoice`, sessionId: session.id, invoiceId: null }
  }

  const decision = decidePayment({
    notice,
    session: { status: session.status, amountMinor: session.amountMinor, currencyCode: session.currencyCode },
    invoice: { status: invoice.status, totalMinor: invoice.totalMinor },
  })
  const base = { sessionId: session.id, invoiceId: invoice.id }
  const pool = getPool()

  switch (decision.kind) {
    case "confirm": {
      const confirmed = await confirmPayment({
        invoiceId: invoice.id,
        sessionId: session.id,
        paidVia: "commercepay",
        capTransactionNumber: notice.transactionNumber,
        gatewayStatusCode: notice.status,
        paidReference: null,
        actorUserId: null,
        source,
      })
      if (!confirmed.ok) {
        return { ...base, outcome: "ignored_status", note: confirmed.message }
      }
      return { ...base, outcome: confirmed.alreadyPaid ? "duplicate" : "accepted", note: null }
    }

    case "duplicate":
      await touchSession(pool, session.id, notice)
      return { ...base, outcome: "duplicate", note: "Session already paid" }

    case "overpayment":
      await markSessionPaid(pool, session.id, notice)
      await raiseAction(
        {
          franchiseId: invoice.franchiseId,
          outletId: null,
          invoiceId: invoice.id,
          reason: "overpayment",
          detail: decision.detail,
        },
        pool
      )
      await recordEvent(pool, invoice.id, "payment_overpayment", null, {
        sessionId: session.id,
        referenceCode: notice.referenceCode,
        capTransactionNumber: notice.transactionNumber,
        amount: notice.amount,
        source,
      })
      log.warn("Second payment on a paid invoice", { invoiceId: invoice.id, referenceCode: notice.referenceCode })
      return { ...base, outcome: "overpayment", note: decision.detail }

    case "amount_mismatch":
      await markSessionPaid(pool, session.id, notice)
      await raiseAction(
        {
          franchiseId: invoice.franchiseId,
          outletId: null,
          invoiceId: invoice.id,
          reason: "payment_amount_mismatch",
          detail: decision.detail,
        },
        pool
      )
      await recordEvent(pool, invoice.id, "payment_amount_mismatch", null, {
        sessionId: session.id,
        referenceCode: notice.referenceCode,
        capTransactionNumber: notice.transactionNumber,
        amount: notice.amount,
        currencyCode: notice.currencyCode,
        sessionAmountMinor: session.amountMinor,
        invoiceTotalMinor: invoice.totalMinor,
        source,
      })
      log.warn("Payment did not match the invoice", { invoiceId: invoice.id, detail: decision.detail })
      return { ...base, outcome: "amount_mismatch", note: decision.detail }

    case "session_closed": {
      await pool.query<ResultSetHeader>(
        `UPDATE renewal_payment_sessions
            SET status = ?, gateway_status_code = ?, last_queried_at = NOW(3),
                cap_transaction_number = COALESCE(?, cap_transaction_number),
                failure_message = ?
          WHERE id = ? AND status IN ('created', 'payment_pending')`,
        [
          decision.sessionStatus,
          notice.status,
          notice.transactionNumber,
          `Gateway reported the attempt ${decision.sessionStatus}`.slice(0, 500),
          session.id,
        ]
      )
      await recordEvent(pool, invoice.id, `payment_session_${decision.sessionStatus}`, null, {
        sessionId: session.id,
        referenceCode: notice.referenceCode,
        gatewayStatusCode: notice.status,
        source,
      })
      // The merchant is free to try again; the term switcher unlocks with it.
      if (invoice.status === "payment_pending" && !(await findLiveSession(invoice.id, pool))) {
        await setInvoiceStatus(invoice.id, "issued", null, `Payment attempt ${decision.sessionStatus}`, pool)
      }
      return { ...base, outcome: "accepted", note: `Session ${decision.sessionStatus}` }
    }

    case "refunded":
      await touchSession(pool, session.id, notice)
      await raiseAction(
        {
          franchiseId: invoice.franchiseId,
          outletId: null,
          invoiceId: invoice.id,
          reason: "payment_refunded",
          detail: `The gateway reports a refund on ${notice.referenceCode} (status ${notice.status}).`,
        },
        pool
      )
      await recordEvent(pool, invoice.id, "payment_refunded", null, {
        sessionId: session.id,
        referenceCode: notice.referenceCode,
        gatewayStatusCode: notice.status,
        source,
      })
      return { ...base, outcome: "refunded", note: "Refund reported by the gateway" }

    case "ignore":
      await touchSession(pool, session.id, notice)
      return { ...base, outcome: "ignored_status", note: decision.note }
  }
}

/** Record what the gateway said without changing the session's state. */
async function touchSession(db: Queryable, sessionId: string, notice: GatewayNotice): Promise<void> {
  await db.query<ResultSetHeader>(
    `UPDATE renewal_payment_sessions
        SET gateway_status_code = ?, last_queried_at = NOW(3),
            cap_transaction_number = COALESCE(cap_transaction_number, ?)
      WHERE id = ?`,
    [notice.status, notice.transactionNumber, sessionId]
  )
}

/**
 * The gateway took the money on this session even though the invoice is not
 * being marked paid. Recording that on the session keeps the sweep from
 * asking about it again and keeps the evidence where the timeline looks.
 */
async function markSessionPaid(db: Queryable, sessionId: string, notice: GatewayNotice): Promise<void> {
  await db.query<ResultSetHeader>(
    `UPDATE renewal_payment_sessions
        SET status = 'paid', paid_at = COALESCE(paid_at, NOW(3)),
            gateway_status_code = ?, last_queried_at = NOW(3),
            cap_transaction_number = COALESCE(?, cap_transaction_number)
      WHERE id = ?`,
    [notice.status, notice.transactionNumber, sessionId]
  )
}
