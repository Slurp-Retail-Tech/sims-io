/**
 * What the merchant sees behind their renewal link, and what they may change.
 *
 * The token is the only credential. Everything here treats the token holder
 * as the merchant: they may read the invoice, switch its term, download the
 * document and start a payment. They may never mark anything paid; that is
 * the callback's job, and it verifies a signature first.
 *
 * The view deliberately carries no internal ids beyond outlet ids, which the
 * merchant already knows. Contact ids, assignment ids and plan ids stay on
 * the server.
 */

import getPool, { withTransaction, type Queryable } from "../db.ts"
import type { ResultSetHeader, RowDataPacket } from "mysql2/promise"
import { createHash } from "node:crypto"

import { createLogger } from "../logger.ts"
import { addDays } from "./invoice-build.ts"
import type { InvoiceTotals } from "./invoice-build.ts"
import { ensureInvoicePdf, sellerBlock } from "./invoice-pdf.ts"
import {
  findTaxInvoiceForProforma,
  getInvoiceById,
  getInvoiceByToken,
  loadInvoiceItems,
  minorToDecimal,
  recordEvent,
} from "./invoices.ts"
import type { ExtensionStatus, InvoiceItemRecord, InvoiceRecord, InvoiceStatus } from "./invoices.ts"
import { getPlan, listAssignments } from "./plans.ts"
import type { BillingTerm } from "./plan-resolution.ts"
import { loadRenewalSettings } from "./settings.ts"
import type { RenewalSettings } from "./settings.ts"
import {
  availableTermsForInvoice,
  repriceInvoiceForTerm,
} from "./term-change.ts"
import type { LineContext } from "./term-change.ts"
import { todayInAppZone } from "./app-date.ts"
import { isRenewalTokenShape, payabilityOf } from "./public-invoice-rules.ts"
import type { Payability } from "./public-invoice-rules.ts"

const log = createLogger("renewal:public")

export { isRenewalTokenShape, payabilityOf }
export type { Payability }

export function hashClientIp(ip: string): string {
  return createHash("sha256").update(ip).digest("hex")
}

export type PublicLine = {
  outletId: string
  outletName: string | null
  licensePlan: string | null
  previousValidUntil: string | null
  newValidUntil: string | null
  catalogMinor: number | null
  adjustmentMinor: number
  amountMinor: number
}

export type PublicPaymentState = {
  state: "none" | "pending" | "paid" | "failed" | "expired"
  /** Present while a session is open, so the page can resume it. */
  redirectUrl: string | null
  expiresAt: string | null
  paidAt: string | null
}

/** What each offered term would cost, so the page can show both prices. */
export type TermQuote = {
  term: BillingTerm
  termMonths: number
  totalMinor: number
  periodEnd: string | null
}

export type PublicInvoiceView = {
  invoiceNumber: string
  status: InvoiceStatus
  payability: Payability
  outletCount: number
  termQuotes: TermQuote[]
  /** Which documents exist for download. Receipt and tax invoice arrive on payment. */
  documents: { proforma: boolean; receipt: boolean; taxInvoice: boolean }
  /** The tax invoice number once issued, for the receipt page. */
  taxInvoiceNumber: string | null
  /** The letterhead every renewal document prints, so the page and the PDF never disagree. */
  seller: { name: string; lines: readonly string[] }
  /** Whether the licence dates have moved yet after payment. */
  extension: ExtensionStatus
  paidVia: "commercepay" | "manual" | null
  companyName: string | null
  franchiseId: string
  issueDate: string | null
  dueDate: string | null
  graceEndsOn: string | null
  currencyCode: string
  term: BillingTerm
  termMonths: number | null
  periodStart: string | null
  periodEnd: string | null
  availableTerms: BillingTerm[]
  termLocked: boolean
  lines: PublicLine[]
  totals: InvoiceTotals
  taxRatePercent: number
  paymentEmail: string | null
  payment: PublicPaymentState
  isGrouped: boolean
}

export type LoadedPublicInvoice = {
  invoice: InvoiceRecord
  items: InvoiceItemRecord[]
  lineContexts: LineContext[]
  settings: RenewalSettings
  /** Issued on payment; null until then. */
  taxInvoice: InvoiceRecord | null
}

export async function loadPublicInvoice(
  token: string,
  db: Queryable = getPool()
): Promise<LoadedPublicInvoice | null> {
  if (!isRenewalTokenShape(token)) {
    return null
  }
  const invoice = await getInvoiceByToken(token, db)
  if (!invoice) {
    return null
  }
  return loadInvoiceContext(invoice, db)
}

/** The same context, for staff routes that address the invoice by id. */
export async function loadInvoiceContextById(
  invoiceId: string,
  db: Queryable = getPool()
): Promise<LoadedPublicInvoice | null> {
  const invoice = await getInvoiceById(invoiceId, db)
  if (!invoice) {
    return null
  }
  return loadInvoiceContext(invoice, db)
}

async function loadInvoiceContext(
  invoice: InvoiceRecord,
  db: Queryable
): Promise<LoadedPublicInvoice> {
  const [items, settings, taxInvoice] = await Promise.all([
    loadInvoiceItems(invoice.id, db),
    loadRenewalSettings(db),
    invoice.status === "paid" && invoice.documentType === "proforma"
      ? findTaxInvoiceForProforma(invoice.id, db)
      : Promise.resolve(null),
  ])
  const lineContexts = await loadLineContexts(invoice, items, db)
  return { invoice, items, lineContexts, settings, taxInvoice }
}

/**
 * Attach the plan and assignment each line was priced from.
 *
 * Superseded assignments are included on purpose: the line points at the
 * assignment that priced it, and that row may since have been replaced.
 */
async function loadLineContexts(
  invoice: InvoiceRecord,
  items: readonly InvoiceItemRecord[],
  db: Queryable
): Promise<LineContext[]> {
  const planIds = [...new Set(items.map((item) => item.planId).filter(Boolean))] as string[]
  const plans = new Map(
    (await Promise.all(planIds.map((id) => getPlan(id, db)))).flatMap((plan) =>
      plan ? [[plan.id, plan] as const] : []
    )
  )
  const assignments = new Map(
    (
      await listAssignments(
        { franchiseId: invoice.franchiseId, includeSuperseded: true },
        db
      )
    ).map((assignment) => [assignment.id, assignment] as const)
  )

  return items.map((item) => ({
    itemId: item.id,
    outletId: item.outletId,
    plan: item.planId ? plans.get(item.planId) ?? null : null,
    assignment: item.assignmentId ? assignments.get(item.assignmentId) ?? null : null,
    cycleOverrideMinor: item.cycleOverrideMinor,
    previousValidUntilDate: item.previousValidUntil
      ? item.previousValidUntil.slice(0, 10)
      : null,
  }))
}

export function buildPublicView(
  loaded: LoadedPublicInvoice,
  payment: PublicPaymentState,
  today: string = todayInAppZone()
): PublicInvoiceView {
  const { invoice, items, lineContexts, settings, taxInvoice } = loaded
  const term: BillingTerm = invoice.billingPlanSelected ?? items[0]?.billingPlan ?? "annually"
  const payability = payabilityOf(invoice, settings.graceWindowDays, today)
  const available = availableTermsForInvoice(lineContexts, term)
  const termLocked = payability !== "payable" || payment.state === "pending" || available.length <= 1

  // Quote every offered term from the same resolution a switch would use, so
  // the price shown before switching is the price charged after.
  const termQuotes: TermQuote[] = []
  for (const candidate of available) {
    if (candidate === term) {
      termQuotes.push({
        term,
        termMonths: invoice.termMonths ?? 0,
        totalMinor: invoice.totalMinor,
        periodEnd: invoice.periodEnd,
      })
      continue
    }
    const quote = repriceInvoiceForTerm({
      lines: lineContexts,
      term: candidate,
      taxRatePercent: settings.taxRatePercent,
      thresholdPercent: settings.overrideVarianceThresholdPct,
    })
    if (quote.ok) {
      termQuotes.push({
        term: candidate,
        termMonths: quote.termMonths,
        totalMinor: quote.totals.totalMinor,
        periodEnd: quote.periodEnd,
      })
    }
  }

  return {
    invoiceNumber: invoice.invoiceNumber,
    status: invoice.status,
    payability,
    outletCount: items.length,
    termQuotes,
    documents: {
      proforma: true,
      receipt: invoice.status === "paid" && Boolean(invoice.receiptPdfObjectKey),
      taxInvoice: Boolean(taxInvoice?.pdfObjectKey),
    },
    taxInvoiceNumber: taxInvoice?.invoiceNumber ?? null,
    seller: sellerBlock(),
    extension: invoice.extensionStatus,
    paidVia: invoice.paidVia,
    companyName: invoice.companyName,
    franchiseId: invoice.franchiseId,
    issueDate: invoice.issueDate,
    dueDate: invoice.dueDate,
    graceEndsOn: invoice.dueDate
      ? addDays(invoice.dueDate, Math.max(0, settings.graceWindowDays))
      : null,
    currencyCode: invoice.currencyCode,
    term,
    termMonths: invoice.termMonths,
    periodStart: invoice.periodStart,
    periodEnd: invoice.periodEnd,
    availableTerms: available,
    termLocked,
    lines: items.map((item) => ({
      outletId: item.outletId,
      outletName: item.outletName,
      licensePlan: item.licensePlan,
      previousValidUntil: item.previousValidUntil?.slice(0, 10) ?? null,
      newValidUntil: item.newValidUntil?.slice(0, 10) ?? null,
      catalogMinor: item.catalogAmountMinor,
      adjustmentMinor: item.adjustmentAmountMinor,
      amountMinor: item.effectiveAmountMinor,
    })),
    totals: {
      subtotalMinor: invoice.subtotalMinor,
      adjustmentMinor: invoice.adjustmentMinor,
      taxMinor: invoice.taxMinor,
      totalMinor: invoice.totalMinor,
    },
    taxRatePercent: invoice.taxRatePercent,
    paymentEmail: invoice.paymentEmail,
    payment,
    isGrouped: invoice.isGrouped,
  }
}

export type TermChangeOutcome =
  | { ok: true }
  | {
      ok: false
      reason:
        | "not_payable"
        | "term_unavailable"
        | "requires_approval"
        | "no_plan"
        | "payment_in_progress"
        | "unchanged"
      outletId?: string | null
    }

/**
 * Switch the invoice to `term`, repricing every line.
 *
 * Refused while a payment session is open: the gateway holds the old amount
 * and a session for a different amount would have to replace it first. The
 * caller supersedes the session and calls again, or asks the merchant to
 * finish paying.
 */
export async function applyTermChange(
  loaded: LoadedPublicInvoice,
  term: BillingTerm,
  options: { hasOpenSession: boolean; actor: "merchant" | "staff"; actorUserId?: string | null },
  today: string = todayInAppZone()
): Promise<TermChangeOutcome> {
  const { invoice, items, lineContexts, settings } = loaded
  const currentTerm: BillingTerm = invoice.billingPlanSelected ?? items[0]?.billingPlan ?? "annually"

  if (payabilityOf(invoice, settings.graceWindowDays, today) !== "payable") {
    return { ok: false, reason: "not_payable" }
  }
  if (options.hasOpenSession) {
    return { ok: false, reason: "payment_in_progress" }
  }
  if (term === currentTerm) {
    return { ok: false, reason: "unchanged" }
  }
  if (!availableTermsForInvoice(lineContexts, currentTerm).includes(term)) {
    return { ok: false, reason: "term_unavailable" }
  }

  const repriced = repriceInvoiceForTerm({
    lines: lineContexts,
    term,
    taxRatePercent: settings.taxRatePercent,
    thresholdPercent: settings.overrideVarianceThresholdPct,
  })
  if (!repriced.ok) {
    return { ok: false, reason: repriced.reason, outletId: repriced.outletId }
  }

  await withTransaction(async (connection) => {
    for (const line of repriced.lines) {
      await connection.query<ResultSetHeader>(
        `UPDATE renewal_invoice_items
            SET billing_plan = ?, catalog_amount = ?, effective_amount = ?,
                adjustment_amount = ?, price_source = ?, line_amount = ?,
                new_valid_until = ?
          WHERE id = ? AND invoice_id = ?`,
        [
          line.billingPlan,
          minorToDecimal(line.catalogMinor),
          minorToDecimal(line.effectiveMinor),
          minorToDecimal(line.adjustmentMinor),
          line.priceSource,
          minorToDecimal(line.effectiveMinor),
          line.newValidUntilDate ? `${line.newValidUntilDate} 00:00:00.000` : null,
          line.itemId,
          invoice.id,
        ]
      )
    }

    await connection.query<ResultSetHeader>(
      `UPDATE renewal_invoices
          SET billing_plan_selected = ?, term_months = ?, period_start = ?,
              period_end = ?, subtotal_amount = ?, adjustment_amount = ?,
              tax_amount = ?, total_amount = ?, term_locked_at = NULL
        WHERE id = ?`,
      [
        repriced.term,
        repriced.termMonths,
        repriced.periodStart,
        repriced.periodEnd,
        minorToDecimal(repriced.totals.subtotalMinor),
        minorToDecimal(repriced.totals.adjustmentMinor),
        minorToDecimal(repriced.totals.taxMinor),
        minorToDecimal(repriced.totals.totalMinor),
        invoice.id,
      ]
    )

    await recordEvent(connection, invoice.id, "term_changed", options.actorUserId ?? null, {
      from: currentTerm,
      to: repriced.term,
      totalMinor: repriced.totals.totalMinor,
      by: options.actor,
    })
  })

  // The stored document now shows the wrong amounts. Re-render best-effort;
  // the routes render on demand if this fails.
  try {
    await ensureInvoicePdf(invoice.id, { force: true, actorUserId: options.actorUserId ?? null })
  } catch (error) {
    log.error("PDF re-render after term change failed", error, { invoiceId: invoice.id })
  }

  return { ok: true }
}

export type LinkEventType =
  | "opened"
  | "term_changed"
  | "pay_clicked"
  | "pdf_downloaded"
  | "receipt_viewed"

export async function recordLinkEvent(
  invoiceId: string,
  eventType: LinkEventType,
  meta: { ip: string | null; userAgent: string | null; payload?: Record<string, unknown> },
  db: Queryable = getPool()
): Promise<void> {
  await db.query<ResultSetHeader>(
    `INSERT INTO renewal_link_events (invoice_id, event_type, ip_hash, user_agent, payload_json)
     VALUES (?, ?, ?, ?, ?)`,
    [
      invoiceId,
      eventType,
      meta.ip ? hashClientIp(meta.ip) : null,
      meta.userAgent ? meta.userAgent.slice(0, 255) : null,
      meta.payload ? JSON.stringify(meta.payload) : null,
    ]
  )
}

/**
 * Count a merchant open. `first_opened_at` is stamped once; `open_count`
 * counts every visit. Staff visits are excluded by the caller.
 */
export async function markOpened(invoiceId: string, db: Queryable = getPool()): Promise<void> {
  await db.query<ResultSetHeader>(
    `UPDATE renewal_invoices
        SET first_opened_at = COALESCE(first_opened_at, NOW(3)),
            open_count = open_count + 1
      WHERE id = ?`,
    [invoiceId]
  )
}

export type LinkEventRecord = {
  id: string
  eventType: LinkEventType
  payload: unknown
  createdAt: string
}

/** The merchant's interactions with the link, oldest first, for the timeline. */
export async function listLinkEvents(
  invoiceId: string,
  db: Queryable = getPool()
): Promise<LinkEventRecord[]> {
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT id, event_type, payload_json, created_at
       FROM renewal_link_events WHERE invoice_id = ? ORDER BY id ASC`,
    [invoiceId]
  )
  return (rows as Array<Record<string, unknown>>).map((row) => ({
    id: String(row.id),
    eventType: row.event_type as LinkEventType,
    payload: row.payload_json ?? null,
    createdAt: String(row.created_at),
  }))
}

/** How many merchant opens an invoice has had, for the staff timeline. */
export async function countLinkEvents(
  invoiceId: string,
  db: Queryable = getPool()
): Promise<Record<LinkEventType, number>> {
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT event_type, COUNT(*) AS n FROM renewal_link_events
      WHERE invoice_id = ? GROUP BY event_type`,
    [invoiceId]
  )
  const counts: Record<LinkEventType, number> = {
    opened: 0,
    term_changed: 0,
    pay_clicked: 0,
    pdf_downloaded: 0,
    receipt_viewed: 0,
  }
  for (const row of rows as Array<{ event_type: LinkEventType; n: number | string }>) {
    counts[row.event_type] = Number(row.n)
  }
  return counts
}
