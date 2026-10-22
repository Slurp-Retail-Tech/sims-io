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

import type { DocumentSource } from "./document-content.ts"

/** The documents the preview shows: the three kinds, and a proforma issued as a quotation. */
export type SampleDocumentKind = "proforma" | "quotation" | "tax_invoice" | "receipt"

export const SAMPLE_DOCUMENT_KINDS: readonly SampleDocumentKind[] = ["proforma", "quotation", "tax_invoice", "receipt"]

export const SAMPLE_PROFORMA_NUMBER = "PI-SAMPLE-0001"
export const SAMPLE_QUOTATION_NUMBER = "QT-SAMPLE-0001"
export const SAMPLE_TAX_INVOICE_NUMBER = "INV-SAMPLE-0001"
export const SAMPLE_PO_NUMBER = "PO-SAMPLE-001"

/** One 1-year licence, as the catalog prices it, in sen. */
const SAMPLE_LINE_MINOR = 120_000

export function isSampleDocumentKind(value: string | null | undefined): value is SampleDocumentKind {
  return SAMPLE_DOCUMENT_KINDS.includes(value as SampleDocumentKind)
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
  sample: SampleDocumentKind,
  options: { taxRatePercent: number; today: string }
): DocumentSource {
  const kind = sample === "quotation" ? "proforma" : sample
  const quotation = sample === "quotation"
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
    invoiceNumber:
      kind === "tax_invoice" ? SAMPLE_TAX_INVOICE_NUMBER : quotation ? SAMPLE_QUOTATION_NUMBER : SAMPLE_PROFORMA_NUMBER,
    issuedAs: quotation ? "quotation" : "proforma",
    // A quotation is what companies that raise purchase orders ask for.
    poNumber: quotation ? SAMPLE_PO_NUMBER : null,
    proformaNumber: kind === "tax_invoice" ? SAMPLE_PROFORMA_NUMBER : null,
    taxInvoiceNumber: kind === "receipt" ? SAMPLE_TAX_INVOICE_NUMBER : null,
    issueDate: options.today,
    dueDate: expiry,
    paidAt: paid ? options.today : null,
    paidVia: paid ? "commercepay" : null,
    paymentReference: paid ? "SAMPLE-REF-0001" : null,
    companyName: "Sample Merchant Sdn Bhd",
    // Made-up registration details, so the preview shows where SSM and TIN print.
    billTo: {
      legalName: "Sample Merchant Sdn Bhd",
      regNoType: "BRN",
      registrationNo: "202001000001",
      oldRegistrationNo: "1234567-A",
      tin: "C00000000000",
      sstNo: null,
      street: "1, Jalan Contoh",
      city: "Kuala Lumpur",
      state: "Wilayah Persekutuan Kuala Lumpur",
      postcode: "50000",
      country: "MY",
    },
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
