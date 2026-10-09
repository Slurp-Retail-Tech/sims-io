/**
 * A made-up renewal for previewing documents before any real one exists.
 *
 * Renewal Settings shows what the company details look like on a proforma,
 * tax invoice and receipt. It needs a document to put them on, and it must
 * never borrow a real merchant's invoice for that, so this builds one: a
 * two-outlet grouped renewal whose every name and number says SAMPLE.
 *
 * Pure and runtime-free, so the settings page renders it in the browser and
 * the preview PDF route renders the same thing on the server.
 */

import type { DocumentKind, DocumentSource } from "./document-content.ts"

export const SAMPLE_DOCUMENT_KINDS: readonly DocumentKind[] = ["proforma", "tax_invoice", "receipt"]

export const SAMPLE_PROFORMA_NUMBER = "PI-SAMPLE-0001"
export const SAMPLE_TAX_INVOICE_NUMBER = "INV-SAMPLE-0001"

/** One 1-year licence, as the catalog prices it, in sen. */
const SAMPLE_LINE_MINOR = 120_000

export function isSampleDocumentKind(value: string | null | undefined): value is DocumentKind {
  return SAMPLE_DOCUMENT_KINDS.includes(value as DocumentKind)
}

/**
 * The sample renewal as `kind` would print it.
 *
 * `today` (YYYY-MM-DD) dates the document, so the preview looks current;
 * the outlets expire 15 days later, as the furthest default reminder has it.
 * `taxRatePercent` is the configured rate, so the tax line appears exactly
 * when it would on a real document.
 */
export function buildSampleDocumentSource(
  kind: DocumentKind,
  options: { taxRatePercent: number; today: string }
): DocumentSource {
  const expiry = addDays(options.today, 15)
  const periodEnd = addYears(expiry, 1)
  const paid = kind !== "proforma"

  const subtotalMinor = SAMPLE_LINE_MINOR * 2
  const taxMinor = Math.round((subtotalMinor * options.taxRatePercent) / 100)

  const line = (outletId: string, outletName: string) => ({
    outletId,
    outletName,
    licensePlan: "Sample Plan",
    previousValidUntil: expiry,
    newValidUntil: paid ? periodEnd : null,
    catalogMinor: SAMPLE_LINE_MINOR,
    adjustmentMinor: 0,
    amountMinor: SAMPLE_LINE_MINOR,
  })

  return {
    kind,
    invoiceNumber: kind === "tax_invoice" ? SAMPLE_TAX_INVOICE_NUMBER : SAMPLE_PROFORMA_NUMBER,
    proformaNumber: kind === "tax_invoice" ? SAMPLE_PROFORMA_NUMBER : null,
    taxInvoiceNumber: kind === "receipt" ? SAMPLE_TAX_INVOICE_NUMBER : null,
    issueDate: options.today,
    dueDate: expiry,
    paidAt: paid ? options.today : null,
    paidVia: paid ? "commercepay" : null,
    paymentReference: paid ? "SAMPLE-REF-0001" : null,
    companyName: "Sample Merchant Sdn Bhd",
    franchiseId: "SAMPLE",
    paymentEmail: "accounts@example.com",
    isGrouped: true,
    outletCount: 2,
    term: "annually",
    periodEnd,
    currencyCode: "MYR",
    lines: [line("SAMPLE-1", "Sample Outlet One"), line("SAMPLE-2", "Sample Outlet Two")],
    totals: {
      subtotalMinor,
      taxRatePercent: options.taxRatePercent,
      taxMinor,
      totalMinor: subtotalMinor + taxMinor,
    },
  }
}

function addDays(date: string, days: number): string {
  const [year, month, day] = date.slice(0, 10).split("-").map(Number)
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10)
}

function addYears(date: string, years: number): string {
  const [year, month, day] = date.slice(0, 10).split("-").map(Number)
  return new Date(Date.UTC(year + years, month - 1, day)).toISOString().slice(0, 10)
}
