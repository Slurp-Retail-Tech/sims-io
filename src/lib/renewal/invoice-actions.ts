/**
 * The manual actions a staff member may take on an invoice.
 *
 * Each one is recorded in the timeline with the acting user, because "why is
 * this invoice cancelled" is a question the timeline has to answer without
 * anyone remembering. Nothing here marks an invoice paid; that arrives with
 * the payment callback and the offline-payment path beside it.
 */

import getPool, { withTransaction, type Queryable } from "../db.ts"
import type { ResultSetHeader, RowDataPacket } from "mysql2/promise"

import { createLogger } from "../logger.ts"
import { ensureInvoicePdf } from "./invoice-pdf.ts"
import { minorToDecimal, recordEvent, setInvoiceStatus } from "./invoices.ts"
import type { InvoiceRecord } from "./invoices.ts"
import { applyTaxExclusive, sumMinor } from "./money.ts"
import { confirmPayment, enqueuePostPayment } from "./payment-confirmation.ts"
import { findLiveSession, supersedeOpenSessions } from "./payment-sessions.ts"
import { runPostPayment } from "./post-payment.ts"
import { requiresOverrideApproval, resolvePriceForLine } from "./plan-resolution.ts"
import type { BillingTerm } from "./plan-resolution.ts"
import { applyTermChange, loadInvoiceContextById } from "./public-invoice.ts"
import type { LoadedPublicInvoice } from "./public-invoice.ts"

const log = createLogger("renewal:invoice-actions")

export type ActionOutcome =
  | { ok: true }
  | { ok: false; status: number; message: string }

/** Statuses that can still be acted on. */
function isOpen(invoice: InvoiceRecord): boolean {
  return !["paid", "cancelled", "superseded", "lapsed"].includes(invoice.status)
}

/**
 * Void an invoice.
 *
 * Any open payment session is superseded first so the gateway's copy cannot
 * complete against a document SIMS no longer recognises. A paid invoice is
 * refused: the money is real and voiding it here would hide that.
 */
export async function voidInvoice(
  invoiceId: string,
  reason: string,
  actorUserId: string,
  db: Queryable = getPool()
): Promise<ActionOutcome> {
  const loaded = await loadInvoiceContextById(invoiceId, db)
  if (!loaded) {
    return { ok: false, status: 404, message: "Invoice not found." }
  }
  if (loaded.invoice.status === "paid") {
    return { ok: false, status: 409, message: "A paid invoice cannot be voided." }
  }
  if (!isOpen(loaded.invoice)) {
    return { ok: false, status: 409, message: "This invoice is already closed." }
  }

  await supersedeOpenSessions(invoiceId, db)
  await setInvoiceStatus(invoiceId, "cancelled", actorUserId, reason, db)
  return { ok: true }
}

/**
 * Switch the term on the merchant's behalf.
 *
 * Same repricing as the public switch, recorded as a staff action. An open
 * session is superseded and the invoice returns to issued, because the amount
 * the gateway holds is no longer the amount owed.
 */
export async function setInvoiceTerm(
  invoiceId: string,
  term: BillingTerm,
  actorUserId: string,
  db: Queryable = getPool()
): Promise<ActionOutcome> {
  const loaded = await loadInvoiceContextById(invoiceId, db)
  if (!loaded) {
    return { ok: false, status: 404, message: "Invoice not found." }
  }

  const live = await findLiveSession(invoiceId, db)
  if (live) {
    await supersedeOpenSessions(invoiceId, db)
    if (loaded.invoice.status === "payment_pending") {
      await setInvoiceStatus(invoiceId, "issued", actorUserId, "Payment session superseded by a staff term change", db)
    }
  }

  const outcome = await applyTermChange(loaded, term, {
    hasOpenSession: false,
    actor: "staff",
    actorUserId,
  })
  if (outcome.ok || outcome.reason === "unchanged") {
    return { ok: true }
  }
  const messages: Record<string, string> = {
    not_payable: "This invoice can no longer be changed.",
    term_unavailable: "That term is not priced for every outlet on this invoice.",
    requires_approval: "That term produces a price that needs override approval first.",
    no_plan: "A line on this invoice no longer resolves to a plan.",
    payment_in_progress: "A payment is in progress.",
  }
  return { ok: false, status: 409, message: messages[outcome.reason] ?? "Unable to change the term." }
}

export type CycleOverrideInput = {
  invoiceId: string
  itemId: string
  /** Null clears the override and the line reprices from its assignment. */
  amountMinor: number | null
  reason: string | null
  actorUserId: string
  /** Holds the approve-override key; a variance beyond the threshold is applied and recorded as approved. */
  canApprove: boolean
}

/**
 * Price one line for this invoice only.
 *
 * The assignment is untouched, so the next cycle prices from it again. The
 * override is measured against the assignment price where one exists, which
 * is what the merchant and the approver both mean by "off by how much". A
 * variance beyond the threshold needs the approve key: without it the request
 * is refused rather than quietly held, so the person knows to ask.
 */
export async function applyCycleOverride(
  input: CycleOverrideInput,
  db: Queryable = getPool()
): Promise<ActionOutcome> {
  const loaded = await loadInvoiceContextById(input.invoiceId, db)
  if (!loaded) {
    return { ok: false, status: 404, message: "Invoice not found." }
  }
  if (!isOpen(loaded.invoice)) {
    return { ok: false, status: 409, message: "This invoice can no longer be repriced." }
  }
  if (input.amountMinor !== null && !input.reason?.trim()) {
    return { ok: false, status: 422, message: "Say why the price departs from the assignment." }
  }
  if (input.amountMinor !== null && input.amountMinor <= 0) {
    return { ok: false, status: 422, message: "The override must be a positive amount." }
  }

  const context = loaded.lineContexts.find((line) => line.itemId === input.itemId)
  const item = loaded.items.find((entry) => entry.id === input.itemId)
  if (!context || !item) {
    return { ok: false, status: 404, message: "Line not found on this invoice." }
  }
  if (!context.plan) {
    return { ok: false, status: 409, message: "This line no longer resolves to a plan." }
  }

  const term: BillingTerm = loaded.invoice.billingPlanSelected ?? item.billingPlan
  const price = resolvePriceForLine({
    plan: context.plan,
    assignment: context.assignment,
    term,
    cycleOverrideMinor: input.amountMinor,
    thresholdPercent: loaded.settings.overrideVarianceThresholdPct,
  })
  if (price.status === "plan_missing_term_price") {
    return { ok: false, status: 409, message: "The plan has no price for this term." }
  }

  const needsApproval =
    input.amountMinor !== null &&
    requiresOverrideApproval(price.catalogMinor, input.amountMinor, loaded.settings.overrideVarianceThresholdPct)
  if (needsApproval && !input.canApprove) {
    return {
      ok: false,
      status: 403,
      message: `That is more than ${loaded.settings.overrideVarianceThresholdPct}% from the catalog price and needs someone with price-approval access.`,
    }
  }

  const otherLines = loaded.items.filter((entry) => entry.id !== item.id)
  const subtotalMinor = sumMinor([
    ...otherLines.map((entry) => entry.effectiveAmountMinor),
    price.effectiveMinor,
  ])
  const adjustmentMinor = sumMinor([
    ...otherLines.map((entry) => entry.adjustmentAmountMinor),
    price.adjustmentMinor,
  ])
  const tax = applyTaxExclusive(subtotalMinor, loaded.settings.taxRatePercent)
  const totalChanged = tax.totalMinor !== loaded.invoice.totalMinor

  await withTransaction(async (connection) => {
    await connection.query<ResultSetHeader>(
      `UPDATE renewal_invoice_items
          SET cycle_override_amount = ?, cycle_override_reason = ?,
              cycle_override_approved_by_user_id = ?, cycle_override_approved_at = ?,
              catalog_amount = ?, effective_amount = ?, adjustment_amount = ?,
              price_source = ?, line_amount = ?
        WHERE id = ? AND invoice_id = ?`,
      [
        minorToDecimal(input.amountMinor),
        input.amountMinor === null ? null : input.reason?.trim() ?? null,
        needsApproval ? input.actorUserId : null,
        needsApproval ? new Date().toISOString().slice(0, 19).replace("T", " ") : null,
        minorToDecimal(price.catalogMinor),
        minorToDecimal(price.effectiveMinor),
        minorToDecimal(price.adjustmentMinor),
        price.source,
        minorToDecimal(price.effectiveMinor),
        item.id,
        loaded.invoice.id,
      ]
    )
    await connection.query<ResultSetHeader>(
      `UPDATE renewal_invoices
          SET subtotal_amount = ?, adjustment_amount = ?, tax_amount = ?, total_amount = ?
        WHERE id = ?`,
      [
        minorToDecimal(subtotalMinor),
        minorToDecimal(adjustmentMinor),
        minorToDecimal(tax.taxMinor),
        minorToDecimal(tax.totalMinor),
        loaded.invoice.id,
      ]
    )
    await recordEvent(connection, loaded.invoice.id, "cycle_override_applied", input.actorUserId, {
      itemId: item.id,
      outletId: item.outletId,
      amountMinor: input.amountMinor,
      catalogMinor: price.catalogMinor,
      adjustmentMinor: price.adjustmentMinor,
      reason: input.reason?.trim() ?? null,
      approved: needsApproval,
      totalMinor: tax.totalMinor,
    })
  })

  if (totalChanged) {
    // The gateway holds the old amount; the merchant starts a fresh session.
    await supersedeOpenSessions(loaded.invoice.id, db)
    if (loaded.invoice.status === "payment_pending") {
      await setInvoiceStatus(loaded.invoice.id, "issued", input.actorUserId, "Payment session superseded by a price change", db)
    }
  }

  try {
    await ensureInvoicePdf(loaded.invoice.id, { force: true, actorUserId: input.actorUserId })
  } catch (error) {
    log.error("PDF re-render after cycle override failed", error, { invoiceId: loaded.invoice.id })
  }

  return { ok: true }
}

/** Mark a draft as issued, so it reads as a live document. */
export async function issueInvoice(
  invoiceId: string,
  actorUserId: string,
  db: Queryable = getPool()
): Promise<ActionOutcome> {
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT status FROM renewal_invoices WHERE id = ? AND deleted_at IS NULL`,
    [invoiceId]
  )
  const row = rows[0] as { status?: string } | undefined
  if (!row) {
    return { ok: false, status: 404, message: "Invoice not found." }
  }
  if (row.status !== "draft") {
    return { ok: false, status: 409, message: "Only a draft can be issued." }
  }
  await setInvoiceStatus(invoiceId, "issued", actorUserId, "Issued by staff", db)
  return { ok: true }
}

/**
 * Record a payment that arrived outside the gateway: a bank transfer, a
 * cheque. The reference is the audit trail, so it is required. Settles the
 * invoice through the same path as the callback, so the extension, tax
 * invoice, documents, POS push and payer email all follow.
 */
export async function markPaidOffline(
  invoiceId: string,
  input: { reference: string; note: string | null; payerEmail: string | null },
  actorUserId: string,
  db: Queryable = getPool()
): Promise<ActionOutcome> {
  const loaded = await loadInvoiceContextById(invoiceId, db)
  if (!loaded) {
    return { ok: false, status: 404, message: "Invoice not found." }
  }
  if (loaded.invoice.status === "paid") {
    return { ok: false, status: 409, message: "This invoice is already paid." }
  }
  if (loaded.invoice.status === "cancelled" || loaded.invoice.status === "superseded") {
    return { ok: false, status: 409, message: "This invoice is closed." }
  }
  if (loaded.invoice.documentType !== "proforma") {
    return { ok: false, status: 409, message: "Only a proforma can be marked paid." }
  }
  const reference = input.reference.trim()
  if (!reference) {
    return { ok: false, status: 422, message: "Give the bank or payment reference." }
  }

  if (input.payerEmail && input.payerEmail !== loaded.invoice.paymentEmail) {
    await db.query<ResultSetHeader>(
      `UPDATE renewal_invoices SET payment_email = ? WHERE id = ?`,
      [input.payerEmail, invoiceId]
    )
  }
  await recordEvent(db, invoiceId, "offline_payment_recorded", actorUserId, {
    reference,
    note: input.note?.trim() || null,
    payerEmail: input.payerEmail ?? loaded.invoice.paymentEmail,
  })

  const outcome = await confirmPayment({
    invoiceId,
    sessionId: null,
    paidVia: "manual",
    capTransactionNumber: null,
    gatewayStatusCode: null,
    // ASCII separator: this string is printed on the receipt PDF, whose
    // standard fonts cannot be trusted with every glyph.
    paidReference: [reference, input.note?.trim()].filter(Boolean).join(" - ").slice(0, 120),
    actorUserId,
    source: "manual",
  })
  if (!outcome.ok) {
    return { ok: false, status: outcome.status, message: outcome.message }
  }
  return { ok: true }
}

/**
 * Close the open payment session so the merchant starts a fresh one.
 *
 * For when the gateway's copy is stuck or the merchant reports the payment
 * page will not open. SIMS cannot open a session on the merchant's behalf,
 * because the session carries their IP and browser; it can only clear the
 * way for the next Pay click.
 */
export async function resetPaymentSession(
  invoiceId: string,
  actorUserId: string,
  db: Queryable = getPool()
): Promise<ActionOutcome> {
  const loaded = await loadInvoiceContextById(invoiceId, db)
  if (!loaded) {
    return { ok: false, status: 404, message: "Invoice not found." }
  }
  if (!isOpen(loaded.invoice)) {
    return { ok: false, status: 409, message: "This invoice is closed." }
  }
  const superseded = await supersedeOpenSessions(invoiceId, db)
  if (superseded === 0) {
    return { ok: false, status: 409, message: "There is no open payment session to reset." }
  }
  await recordEvent(db, invoiceId, "payment_session_reset", actorUserId, { superseded })
  if (loaded.invoice.status === "payment_pending") {
    await setInvoiceStatus(invoiceId, "issued", actorUserId, "Payment session reset by staff", db)
  }
  return { ok: true }
}

/** Send the receipt and tax invoice again, optionally to a corrected address. */
export async function resendPayerEmail(
  invoiceId: string,
  payerEmail: string | null,
  actorUserId: string,
  db: Queryable = getPool()
): Promise<ActionOutcome> {
  const loaded = await loadInvoiceContextById(invoiceId, db)
  if (!loaded) {
    return { ok: false, status: 404, message: "Invoice not found." }
  }
  if (loaded.invoice.status !== "paid") {
    return { ok: false, status: 409, message: "The documents exist only once the invoice is paid." }
  }
  const target = payerEmail ?? loaded.invoice.paymentEmail
  if (!target) {
    return { ok: false, status: 422, message: "There is no payer email on this invoice. Enter one." }
  }
  if (target !== loaded.invoice.paymentEmail) {
    await db.query<ResultSetHeader>(
      `UPDATE renewal_invoices SET payment_email = ?, payer_email_status = 'pending' WHERE id = ?`,
      [target, invoiceId]
    )
  }
  await recordEvent(db, invoiceId, "payer_email_resend_requested", actorUserId, { to: target })

  const report = await runPostPayment(invoiceId, { forcePayerEmail: true })
  const email = report.steps.find((step) => step.step === "payer_email")
  if (!email || email.outcome === "failed") {
    return { ok: false, status: 502, message: email?.note ?? "The email could not be sent." }
  }
  if (email.outcome === "skipped") {
    return { ok: false, status: 409, message: email.note ?? "Nothing was sent." }
  }
  return { ok: true }
}

/** Queue the post-payment steps again after a person has fixed the cause. */
export async function retryPostPayment(
  invoiceId: string,
  actorUserId: string,
  db: Queryable = getPool()
): Promise<ActionOutcome> {
  const loaded = await loadInvoiceContextById(invoiceId, db)
  if (!loaded) {
    return { ok: false, status: 404, message: "Invoice not found." }
  }
  if (loaded.invoice.status !== "paid") {
    return { ok: false, status: 409, message: "Only a paid invoice has post-payment steps." }
  }
  await recordEvent(db, invoiceId, "post_payment_retry_requested", actorUserId, null)
  await enqueuePostPayment(invoiceId, actorUserId, db)
  return { ok: true }
}

/**
 * Re-print an open proforma, so it picks up changed company details or a
 * corrected template.
 *
 * Open proformas only. A tax invoice or receipt is an issued record and keeps
 * the letterhead it was printed with; silently changing a document the
 * merchant already holds is exactly what an audit trail exists to prevent.
 * Recorded in the timeline as a forced render with the acting user.
 */
export async function reprintProforma(
  invoiceId: string,
  actorUserId: string,
  db: Queryable = getPool()
): Promise<ActionOutcome> {
  const loaded = await loadInvoiceContextById(invoiceId, db)
  if (!loaded) {
    return { ok: false, status: 404, message: "Invoice not found." }
  }
  if (loaded.invoice.documentType !== "proforma") {
    return { ok: false, status: 409, message: "Only a proforma can be re-printed. Issued documents keep their letterhead." }
  }
  if (!isOpen(loaded.invoice)) {
    return { ok: false, status: 409, message: "Only an open proforma can be re-printed." }
  }
  await ensureInvoicePdf(invoiceId, { force: true, actorUserId }, db)
  return { ok: true }
}

export type { LoadedPublicInvoice }
