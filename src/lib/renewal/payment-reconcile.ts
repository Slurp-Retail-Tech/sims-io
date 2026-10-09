/**
 * The hourly safety net under the callback.
 *
 * A callback can fail to arrive: the gateway's retry gives up, a deploy is
 * mid-restart, a proxy drops it. Every open session that reached the gateway
 * is therefore asked about directly, and a payment found this way is settled
 * exactly as a callback would have settled it, flagged `reconciledBySweep` so
 * the analytics can count how often the net was needed.
 *
 * The same run re-queues the post-payment steps for any paid invoice still
 * missing one, inside the retry window. After the window a person takes over
 * from Actions Required.
 */

import getPool, { type Queryable } from "../db.ts"
import type { ResultSetHeader, RowDataPacket } from "mysql2/promise"

import type { CommercePayClient } from "../commercepay/client.ts"
import { isTransactionNotFound } from "../commercepay/response.ts"
import { createLogger } from "../logger.ts"
import { setInvoiceStatus } from "./invoices.ts"
import { enqueuePostPayment, processGatewayNotice } from "./payment-confirmation.ts"
import { findLiveSession } from "./payment-sessions.ts"
import { listInvoicesNeedingFollowUp } from "./post-payment.ts"

const log = createLogger("renewal:payment-reconcile")

/** Sessions queried per run. Hourly, so a backlog clears in a few runs. */
const SESSION_BATCH = 200

/** Leave a fresh session alone: the callback is probably still on its way. */
const MIN_SESSION_AGE_MINUTES = 3

export type ReconcileReport = {
  sessionsQueried: number
  paidFound: number
  closed: number
  expired: number
  queryFailures: number
  followUpsQueued: number
}

type OpenSessionRow = RowDataPacket & {
  id: string
  invoice_id: string
  reference_code: string
  cap_session_number: string
  expires_at: string | null
  expired: number
}

export async function reconcilePayments(
  client: CommercePayClient | null,
  db: Queryable = getPool()
): Promise<ReconcileReport> {
  const report: ReconcileReport = {
    sessionsQueried: 0,
    paidFound: 0,
    closed: 0,
    expired: 0,
    queryFailures: 0,
    followUpsQueued: 0,
  }

  if (client) {
    const [rows] = await db.query<OpenSessionRow[]>(
      `SELECT id, invoice_id, reference_code, cap_session_number, expires_at,
              (expires_at IS NOT NULL AND expires_at < NOW(3)) AS expired
         FROM renewal_payment_sessions
        WHERE status IN ('created', 'payment_pending')
          AND cap_session_number IS NOT NULL
          AND created_at < DATE_SUB(NOW(3), INTERVAL ? MINUTE)
        ORDER BY id ASC
        LIMIT ${SESSION_BATCH}`,
      [MIN_SESSION_AGE_MINUTES]
    )

    for (const row of rows) {
      report.sessionsQueried += 1
      const result = await querySessionOnce(client, row, db)
      if (result === "paid") {
        report.paidFound += 1
      } else if (result === "closed") {
        report.closed += 1
      } else if (result === "expired") {
        report.expired += 1
      } else if (result === "query_failed") {
        report.queryFailures += 1
      }
    }
  }

  for (const invoiceId of await listInvoicesNeedingFollowUp(db)) {
    const { created } = await enqueuePostPayment(invoiceId, null, db)
    if (created) {
      report.followUpsQueued += 1
    }
  }

  return report
}

export type SessionQueryResult = "paid" | "closed" | "expired" | "query_failed" | "still_pending"

/**
 * Ask the gateway about one session and settle whatever it says, exactly as
 * a callback would. Shared by the hourly sweep and the receipt page's
 * on-demand check, so the two can never settle a payment differently.
 */
async function querySessionOnce(
  client: CommercePayClient,
  row: Pick<OpenSessionRow, "id" | "invoice_id" | "reference_code" | "cap_session_number" | "expired">,
  db: Queryable
): Promise<SessionQueryResult> {
  const query = await client.queryPayment({ sessionNumber: row.cap_session_number })

  if (!query.ok) {
    if (isTransactionNotFound(query) && Number(row.expired) === 1) {
      // Nobody ever paid on it and it can no longer be paid. Close it.
      await expireSession(db, String(row.id), String(row.invoice_id))
      return "expired"
    }
    await db.query<ResultSetHeader>(
      `UPDATE renewal_payment_sessions SET last_queried_at = NOW(3) WHERE id = ?`,
      [row.id]
    )
    return "query_failed"
  }

  const result = query.result
  const outcome = await processGatewayNotice(
    {
      // Our reference, not the gateway's echo: the session row is the
      // authority on which attempt this is.
      referenceCode: row.reference_code,
      status: result.status,
      amount: Number.isInteger(result.amount) ? result.amount : null,
      currencyCode: result.currencyCode ?? null,
      transactionNumber: result.transactionNumber ?? null,
      paymentSessionNumber: result.paymentSessionNumber ?? row.cap_session_number,
      providerTransactionNumber: result.providerTransactionNumber ?? null,
    },
    "sweep"
  )

  if (outcome.outcome === "accepted" && outcome.note === null) {
    log.info("Payment found by query", { invoiceId: row.invoice_id, referenceCode: row.reference_code })
    return "paid"
  }
  if (outcome.outcome === "accepted") {
    return "closed"
  }
  if (outcome.outcome === "ignored_status" && Number(row.expired) === 1) {
    // Still "pending" at the gateway but past the expiry SIMS asked for.
    await expireSession(db, String(row.id), String(row.invoice_id))
    return "expired"
  }
  return "still_pending"
}

/**
 * One gateway query for an invoice's open session, on demand.
 *
 * The receipt page calls this while it waits, so a lost callback costs the
 * merchant a minute rather than up to an hour until the sweep. The caller
 * throttles it. Returns null when there is no session that reached the
 * gateway to ask about.
 */
export async function checkInvoicePaymentNow(
  invoiceId: string,
  client: CommercePayClient,
  db: Queryable = getPool()
): Promise<SessionQueryResult | null> {
  const [rows] = await db.query<OpenSessionRow[]>(
    `SELECT id, invoice_id, reference_code, cap_session_number, expires_at,
            (expires_at IS NOT NULL AND expires_at < NOW(3)) AS expired
       FROM renewal_payment_sessions
      WHERE invoice_id = ?
        AND status IN ('created', 'payment_pending')
        AND cap_session_number IS NOT NULL
      ORDER BY id DESC
      LIMIT 1`,
    [invoiceId]
  )
  const row = rows[0]
  return row ? querySessionOnce(client, row, db) : null
}

async function expireSession(db: Queryable, sessionId: string, invoiceId: string): Promise<void> {
  await db.query<ResultSetHeader>(
    `UPDATE renewal_payment_sessions
        SET status = 'expired', last_queried_at = NOW(3),
            failure_message = 'Session expired without payment'
      WHERE id = ? AND status IN ('created', 'payment_pending')`,
    [sessionId]
  )
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT status FROM renewal_invoices WHERE id = ?`,
    [invoiceId]
  )
  const status = (rows[0] as { status?: string } | undefined)?.status
  if (status === "payment_pending" && !(await findLiveSession(invoiceId, db))) {
    await setInvoiceStatus(invoiceId, "issued", null, "Payment session expired", db)
  }
}
