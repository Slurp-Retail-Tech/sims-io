/**
 * Shaping a `PublicInvoice` into the fields `RenewalDocumentCard` renders.
 *
 * Every value here is read from the API response; nothing is invented. The
 * description and duration lines follow the same "(RN) … LICENSE RENEWAL"
 * format the PDF and the accounting export already use, so a merchant sees
 * the identical wording wherever the document appears.
 */

import { docDate, longDate, money, TERM_DOC_LABELS, TERM_LABELS } from "./format"
import type { DocMetaRow, DocumentLineRow } from "./document-card"
import type { PublicInvoice } from "./types"

/** `RM 1,200.00` with a sign, for a line's adjustment note. */
function signedMoney(minor: number, currency: string): string {
  if (minor === 0) {
    return money(0, currency)
  }
  const formatted = money(Math.abs(minor), currency)
  return minor < 0 ? `-${formatted}` : `+${formatted}`
}

export function buildBillTo(view: PublicInvoice): { name: string; lines: string[] } {
  const lines: string[] = [`Franchise ID ${view.franchiseId}`]
  if (view.paymentEmail) {
    lines.push(view.paymentEmail)
  }
  return { name: view.companyName ?? `Franchise ${view.franchiseId}`, lines }
}

export function buildShipTo(view: PublicInvoice): { name: string; lines: string[] } {
  const outletNames = view.lines.map((line) => line.outletName ?? `Outlet ${line.outletId}`)
  if (view.isGrouped) {
    return {
      name: `Outlet: ${view.outletCount} outlets, grouped`,
      lines: [outletNames.join(" · "), `FID ${view.franchiseId}`],
    }
  }
  const only = view.lines[0]
  return {
    name: `Outlet: ${outletNames[0] ?? `outlet ${only?.outletId ?? ""}`}`,
    lines: [`OID ${only?.outletId ?? "—"}`, `FID ${view.franchiseId}`],
  }
}

export function buildDocTitle(view: PublicInvoice, suffix?: string): string {
  const who = (view.companyName ?? `FRANCHISE ${view.franchiseId}`).toUpperCase()
  const outlets = `${view.outletCount} ${view.outletCount === 1 ? "OUTLET" : "OUTLETS"}`
  const term = TERM_DOC_LABELS[view.term] ?? view.term.toUpperCase()
  return `(RN) ${who} @ ${outlets} - SLURP! LICENSE RENEWAL (${term})${suffix ? ` - ${suffix}` : ""}`
}

export function buildDocLines(view: PublicInvoice): DocumentLineRow[] {
  const term = TERM_DOC_LABELS[view.term] ?? view.term.toUpperCase()
  return view.lines.map((line, index) => {
    const plan = (line.licensePlan ?? "SLURP").toUpperCase()
    // Before the licence is extended, the line carries no new_valid_until yet;
    // the invoice's own projected period end is the same date the term-quote
    // and the term selector already show, so the document agrees with them.
    const periodEnd = line.newValidUntil ?? view.periodEnd
    return {
      key: line.outletId,
      no: String(index + 1),
      description: `(RN) SLURP! ${plan} LICENSE RENEWAL (${term})`,
      outlet: `${(line.outletName ?? `OUTLET ${line.outletId}`).toUpperCase()} · OID ${line.outletId}`,
      duration: `Subscription period: ${docDate(line.previousValidUntil)} – ${docDate(periodEnd)}`,
      adjustmentNote:
        line.adjustmentMinor !== 0
          ? `Adjustment ${signedMoney(line.adjustmentMinor, view.currencyCode)}`
          : null,
      qty: "1",
      unitPrice: money(line.catalogMinor ?? line.amountMinor, view.currencyCode),
      amount: money(line.amountMinor, view.currencyCode),
    }
  })
}

export function buildProformaDocMeta(view: PublicInvoice): DocMetaRow[] {
  return [
    { label: "No.", value: view.invoiceNumber, mono: true },
    { label: "Date", value: longDate(view.issueDate) },
    { label: "Due date", value: longDate(view.dueDate) },
    { label: "Term", value: TERM_LABELS[view.term] ?? view.term },
  ]
}

export function buildReceiptDocMeta(view: PublicInvoice): DocMetaRow[] {
  return [
    { label: "No.", value: view.invoiceNumber, mono: true },
    { label: "Tax invoice", value: view.taxInvoiceNumber ?? "Pending", mono: Boolean(view.taxInvoiceNumber) },
    { label: "Date", value: longDate(view.payment.paidAt?.slice(0, 10)) },
    { label: "Method", value: view.paidVia === "manual" ? "Bank transfer" : "CommercePay" },
  ]
}
