/**
 * Payment sessions: one row per attempt to collect an invoice through
 * CommercePay's hosted session checkout.
 *
 * The sequence in `{invoice number}-{n}` is allocated under a row lock on
 * the invoice, so two merchants (or two tabs) clicking Pay at once cannot
 * produce the same reference code. The gateway call happens AFTER the row is
 * committed: a session that exists in SIMS but never reached the gateway is
 * recorded as failed and superseded, whereas a session that reached the
 * gateway but was never recorded would be money with no home.
 *
 * A live session is reused rather than replaced. CommercePay keeps the
 * session open for retries, and reopening the same URL is the documented
 * path when a merchant closes the tab by accident.
 */

import getPool, { withTransaction, type Queryable } from "../db.ts"
import type { ResultSetHeader, RowDataPacket } from "mysql2/promise"

import { createLogger } from "../logger.ts"
import type { CommercePayClient } from "../commercepay/client.ts"
import { toGatewayMinorUnits } from "./money.ts"
import { minorToDecimal, recordEvent, setInvoiceStatus } from "./invoices.ts"
import type { InvoiceRecord } from "./invoices.ts"
import { toObjectKeySafeNumber } from "./numbering.ts"
import type { BillingTerm } from "./plan-resolution.ts"
import type { RenewalSettings } from "./settings.ts"
import { hashClientIp } from "./public-invoice.ts"

const log = createLogger("renewal:payment-sessions")

export type SessionStatus =
  | "created"
  | "payment_pending"
  | "paid"
  | "failed"
  | "expired"
  | "cancelled"
  | "superseded"

export type PaymentSessionRecord = {
  id: string
  invoiceId: string
  sessionSequence: number
  referenceCode: string
  currencyCode: string
  amountMinor: number
  billingPlan: BillingTerm
  paymentEmail: string | null
  capSessionNumber: string | null
  capTransactionNumber: string | null
  redirectUrl: string | null
  status: SessionStatus
  gatewayStatusCode: number | null
  expiresAt: string | null
  paidAt: string | null
  createdAt: string
}

type Row = RowDataPacket & {
  id: string
  invoice_id: string
  session_sequence: number
  reference_code: string
  currency_code: string
  amount: string
  billing_plan: BillingTerm
  payment_email: string | null
  cap_session_number: string | null
  cap_transaction_number: string | null
  redirect_url: string | null
  status: SessionStatus
  gateway_status_code: number | null
  expires_at: string | null
  paid_at: string | null
  created_at: string
}

const SELECT = `
  SELECT id, invoice_id, session_sequence, reference_code, currency_code, amount,
         billing_plan, payment_email, cap_session_number, cap_transaction_number,
         redirect_url, status, gateway_status_code, expires_at, paid_at, created_at
    FROM renewal_payment_sessions
`

function mapRow(row: Row): PaymentSessionRecord {
  return {
    id: String(row.id),
    invoiceId: String(row.invoice_id),
    sessionSequence: Number(row.session_sequence),
    referenceCode: row.reference_code,
    currencyCode: row.currency_code,
    amountMinor: Math.round(Number(row.amount) * 100),
    billingPlan: row.billing_plan,
    paymentEmail: row.payment_email,
    capSessionNumber: row.cap_session_number,
    capTransactionNumber: row.cap_transaction_number,
    redirectUrl: row.redirect_url,
    status: row.status,
    gatewayStatusCode: row.gateway_status_code,
    expiresAt: row.expires_at,
    paidAt: row.paid_at,
    createdAt: row.created_at,
  }
}

/** The most recent session, whatever its state. */
export async function findLatestSession(
  invoiceId: string,
  db: Queryable = getPool()
): Promise<PaymentSessionRecord | null> {
  const [rows] = await db.query<Row[]>(
    `${SELECT} WHERE invoice_id = ? ORDER BY session_sequence DESC LIMIT 1`,
    [invoiceId]
  )
  return rows[0] ? mapRow(rows[0]) : null
}

/**
 * A session the merchant can still be sent back to.
 *
 * Live means: reached the gateway, not yet terminal, not expired. It is only
 * reusable when the amount and term still match what the invoice says now;
 * otherwise a term change happened and the session must be replaced.
 */
export async function findLiveSession(
  invoiceId: string,
  db: Queryable = getPool()
): Promise<PaymentSessionRecord | null> {
  const [rows] = await db.query<Row[]>(
    `${SELECT}
      WHERE invoice_id = ?
        AND status IN ('created', 'payment_pending')
        AND (expires_at IS NULL OR expires_at > NOW(3))
      ORDER BY session_sequence DESC LIMIT 1`,
    [invoiceId]
  )
  return rows[0] ? mapRow(rows[0]) : null
}

/** Close every open session on an invoice as superseded. */
export async function supersedeOpenSessions(
  invoiceId: string,
  db: Queryable = getPool()
): Promise<number> {
  const [result] = await db.query<ResultSetHeader>(
    `UPDATE renewal_payment_sessions
        SET status = 'superseded'
      WHERE invoice_id = ? AND status IN ('created', 'payment_pending')`,
    [invoiceId]
  )
  return result.affectedRows
}

export type StartSessionInput = {
  invoice: InvoiceRecord
  term: BillingTerm
  email: string
  ipAddress: string
  userAgent: string | null
  settings: RenewalSettings
  client: CommercePayClient
  /** `https://sims.example` with no trailing slash. */
  baseUrl: string
}

export type StartSessionResult =
  | { ok: true; redirectUrl: string; sessionId: string; reused: boolean }
  | { ok: false; message: string }

/**
 * Open (or resume) the payment session for an invoice.
 *
 * Returns the URL the merchant is sent to. The invoice moves to
 * `payment_pending` and remembers the payer email, which is where the
 * receipt and tax invoice will go; the gateway does not return it.
 */
export async function startPaymentSession(
  input: StartSessionInput
): Promise<StartSessionResult> {
  const { invoice, term, email, ipAddress, userAgent, settings, client, baseUrl } = input

  if (invoice.totalMinor <= 0) {
    return { ok: false, message: "This invoice has nothing to pay." }
  }

  const live = await findLiveSession(invoice.id)
  if (
    live &&
    live.redirectUrl &&
    live.amountMinor === invoice.totalMinor &&
    live.billingPlan === term
  ) {
    await recordEvent(getPool(), invoice.id, "payment_session_resumed", null, {
      sessionId: live.id,
      referenceCode: live.referenceCode,
    })
    return { ok: true, redirectUrl: live.redirectUrl, sessionId: live.id, reused: true }
  }

  // Anything still open is for a different amount or has gone stale.
  await supersedeOpenSessions(invoice.id)

  const expiresInMinutes = Math.max(5, settings.sessionExpiryMinutes)
  const referenceBase = toObjectKeySafeNumber(invoice.invoiceNumber)

  const created = await withTransaction(async (connection) => {
    // Lock the invoice so two concurrent Pay clicks serialise on the sequence.
    await connection.query<RowDataPacket[]>(
      `SELECT id FROM renewal_invoices WHERE id = ? FOR UPDATE`,
      [invoice.id]
    )
    const [seqRows] = await connection.query<RowDataPacket[]>(
      `SELECT COALESCE(MAX(session_sequence), 0) + 1 AS next
         FROM renewal_payment_sessions WHERE invoice_id = ?`,
      [invoice.id]
    )
    const sequence = Number((seqRows[0] as { next: number | string }).next)
    const referenceCode = `${referenceBase}-${sequence}`.slice(0, 50)

    const [result] = await connection.query<ResultSetHeader>(
      `INSERT INTO renewal_payment_sessions
         (invoice_id, session_sequence, reference_code, currency_code, amount,
          billing_plan, payment_email, status, expires_at, ip_hash, user_agent)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'created',
               DATE_ADD(NOW(3), INTERVAL ? MINUTE), ?, ?)`,
      [
        invoice.id,
        sequence,
        referenceCode,
        invoice.currencyCode,
        minorToDecimal(invoice.totalMinor),
        term,
        email,
        expiresInMinutes,
        hashClientIp(ipAddress),
        userAgent ? userAgent.slice(0, 255) : null,
      ]
    )
    return { sessionId: String(result.insertId), referenceCode }
  })

  const request = {
    currencyCode: invoice.currencyCode,
    amount: toGatewayMinorUnits(invoice.totalMinor),
    referenceCode: created.referenceCode,
    description: `Slurp renewal ${invoice.invoiceNumber}`.slice(0, 100),
    ipAddress: ipAddress.slice(0, 50),
    userAgent: userAgent ? userAgent.slice(0, 200) : null,
    returnUrl: `${baseUrl}/renew/${invoice.renewalToken}/receipt`,
    callbackUrl: `${baseUrl}/api/public/commercepay/callback`,
    customer: { email, name: invoice.companyName },
    expiredInMinutes: expiresInMinutes,
  }

  const outcome = await client.initialSession(request)

  if (!outcome.ok || !outcome.result.redirectUrl) {
    const message = outcome.ok
      ? "The payment gateway returned no checkout link."
      : outcome.message
    await getPool().query<ResultSetHeader>(
      `UPDATE renewal_payment_sessions
          SET status = 'failed', failure_message = ?, request_json = ?, response_json = ?
        WHERE id = ?`,
      [
        message.slice(0, 500),
        JSON.stringify(redactRequest(request)),
        outcome.ok ? JSON.stringify(outcome.result) : JSON.stringify({ code: outcome.code, message: outcome.message }),
        created.sessionId,
      ]
    )
    await recordEvent(getPool(), invoice.id, "payment_session_failed", null, {
      sessionId: created.sessionId,
      referenceCode: created.referenceCode,
      message,
    })
    log.warn("CommercePay session could not be opened", {
      invoiceId: invoice.id,
      referenceCode: created.referenceCode,
      message,
    })
    return { ok: false, message: "The payment page could not be opened. Please try again shortly." }
  }

  await getPool().query<ResultSetHeader>(
    `UPDATE renewal_payment_sessions
        SET status = 'payment_pending', cap_session_number = ?, redirect_url = ?,
            request_json = ?, response_json = ?
      WHERE id = ?`,
    [
      outcome.result.sessionNumber,
      outcome.result.redirectUrl,
      JSON.stringify(redactRequest(request)),
      JSON.stringify(outcome.result),
      created.sessionId,
    ]
  )

  await getPool().query<ResultSetHeader>(
    `UPDATE renewal_invoices SET payment_email = ?, term_locked_at = NOW(3) WHERE id = ?`,
    [email, invoice.id]
  )
  if (invoice.status !== "payment_pending") {
    await setInvoiceStatus(invoice.id, "payment_pending", null, "Payment session opened")
  }
  await recordEvent(getPool(), invoice.id, "payment_session_created", null, {
    sessionId: created.sessionId,
    referenceCode: created.referenceCode,
    capSessionNumber: outcome.result.sessionNumber,
    amountMinor: invoice.totalMinor,
    term,
  })

  return {
    ok: true,
    redirectUrl: outcome.result.redirectUrl,
    sessionId: created.sessionId,
    reused: false,
  }
}

/** Keep the audit copy of the request free of the merchant's address. */
function redactRequest(request: Record<string, unknown>): Record<string, unknown> {
  return { ...request, ipAddress: "[hashed]", customer: request.customer ? "[stored on session]" : null }
}

/** Load a session by the gateway's reference code, for the callback. */
export async function findSessionByReference(
  referenceCode: string,
  db: Queryable = getPool()
): Promise<PaymentSessionRecord | null> {
  const [rows] = await db.query<Row[]>(`${SELECT} WHERE reference_code = ? LIMIT 1`, [
    referenceCode,
  ])
  return rows[0] ? mapRow(rows[0]) : null
}
