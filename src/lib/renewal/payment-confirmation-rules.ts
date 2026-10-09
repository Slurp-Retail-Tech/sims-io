/**
 * What a gateway notification means for the session and invoice it names.
 *
 * The callback and the hourly Query sweep both end up here with the same
 * shape, so a payment discovered by the sweep is treated exactly like one
 * announced by the callback. The decision is made against three facts — the
 * gateway's status, what the session asked for, what the invoice now says —
 * and nothing is marked paid unless all three agree.
 *
 * Pure and runtime-free so it can be unit-tested under `node --test`.
 */

import { mapPaymentStatus } from "../commercepay/status.ts"
import type { PaymentState } from "../commercepay/status.ts"

/** The fields SIMS reads from a callback body or a Query result. */
export type GatewayNotice = {
  referenceCode: string
  status: number
  /** Gateway integer units; 1000 = 10.00. Null when the body omitted it. */
  amount: number | null
  currencyCode: string | null
  transactionNumber: string | null
  paymentSessionNumber: string | null
  providerTransactionNumber: string | null
}

/**
 * Read a callback body. Null when it lacks the two fields nothing can be done
 * without: which attempt this is about, and what happened to it.
 */
export function parseGatewayNotice(raw: unknown): GatewayNotice | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return null
  }
  const body = raw as Record<string, unknown>
  const referenceCode = typeof body.referenceCode === "string" ? body.referenceCode.trim() : ""
  const status = typeof body.status === "number" ? body.status : Number(body.status)
  if (!referenceCode || !Number.isInteger(status)) {
    return null
  }
  return {
    referenceCode,
    status,
    amount: readInteger(body.amount),
    currencyCode: typeof body.currencyCode === "string" ? body.currencyCode.trim().toUpperCase() : null,
    transactionNumber: readString(body.transactionNumber),
    paymentSessionNumber: readString(body.paymentSessionNumber),
    providerTransactionNumber: readString(body.providerTransactionNumber),
  }
}

export type SessionFacts = {
  status: string
  amountMinor: number
  currencyCode: string
}

export type InvoiceFacts = {
  status: string
  totalMinor: number
}

export type PaymentDecision =
  /** Mark the session and the invoice paid; start the post-payment work. */
  | { kind: "confirm"; state: PaymentState }
  /** This session is already paid. Nothing to do. */
  | { kind: "duplicate" }
  /** Money arrived for an invoice another session already settled. */
  | { kind: "overpayment"; detail: string }
  /** Money arrived but not the amount the invoice is for. */
  | { kind: "amount_mismatch"; detail: string }
  /** The attempt is over without payment; reopen the invoice. */
  | { kind: "session_closed"; sessionStatus: "failed" | "cancelled" | "expired" }
  /** The gateway reports money going back. A person decides. */
  | { kind: "refunded" }
  /** Not settled, or already closed, or a code this table does not know. */
  | { kind: "ignore"; state: PaymentState; note: string }

const OPEN_SESSION_STATUSES = new Set(["created", "payment_pending"])

export function decidePayment(input: {
  notice: GatewayNotice
  session: SessionFacts
  invoice: InvoiceFacts
}): PaymentDecision {
  const { notice, session, invoice } = input
  const state = mapPaymentStatus(notice.status)

  if (state === "pending" || state === "authorized" || state === "unknown") {
    return {
      kind: "ignore",
      state,
      note: state === "unknown" ? `Unknown gateway status ${notice.status}` : `Gateway status ${state}`,
    }
  }

  if (state === "refunded") {
    return { kind: "refunded" }
  }

  if (state === "failed" || state === "cancelled" || state === "expired") {
    if (OPEN_SESSION_STATUSES.has(session.status)) {
      return { kind: "session_closed", sessionStatus: state }
    }
    return { kind: "ignore", state, note: `Session already ${session.status}` }
  }

  // state === "paid"
  if (session.status === "paid") {
    return { kind: "duplicate" }
  }
  if (invoice.status === "paid") {
    return {
      kind: "overpayment",
      detail: `A second payment arrived on ${notice.referenceCode} after the invoice was already paid.`,
    }
  }
  if (notice.currencyCode && notice.currencyCode !== session.currencyCode.toUpperCase()) {
    return {
      kind: "amount_mismatch",
      detail: `Paid in ${notice.currencyCode}; the invoice is in ${session.currencyCode}.`,
    }
  }
  if (notice.amount !== null && notice.amount !== session.amountMinor) {
    return {
      kind: "amount_mismatch",
      detail: `Gateway reports ${formatMinor(notice.amount)} paid; the session asked for ${formatMinor(session.amountMinor)}.`,
    }
  }
  if (session.amountMinor !== invoice.totalMinor) {
    return {
      kind: "amount_mismatch",
      detail: `Session ${notice.referenceCode} collected ${formatMinor(session.amountMinor)} but the invoice now totals ${formatMinor(invoice.totalMinor)}.`,
    }
  }
  return { kind: "confirm", state }
}

function formatMinor(minor: number): string {
  const negative = minor < 0 ? "-" : ""
  const absolute = Math.abs(minor)
  return `${negative}${Math.trunc(absolute / 100)}.${String(absolute % 100).padStart(2, "0")}`
}

function readInteger(value: unknown): number | null {
  if (typeof value === "number" && Number.isInteger(value)) {
    return value
  }
  if (typeof value === "string" && /^-?\d+$/.test(value.trim())) {
    return Number(value.trim())
  }
  return null
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null
}
