/**
 * Shaping paid invoices into the rows Bukku imports.
 *
 * The file follows Bukku's "Invoices (Credit Sales) - Extended Mode - MY"
 * import template column for column: `#` comment lines, one `$` line naming
 * the columns, and data from the second column on. One row per invoice line
 * item: a grouped invoice with six outlets is six rows sharing an invoice
 * number, because that is how the revenue is recognised per outlet, and Bukku
 * reads repeated header columns as the same invoice.
 *
 * The customer is matched in Bukku by Contact Code, from the franchise's
 * billing profile, and by Legal Name when there is no code. The account, tax
 * and classification codes come from Renewal Settings.
 *
 * Pure and runtime-free so the shaping is unit-tested.
 */

import { addMonths } from "./invoice-build.ts"
import { formatMinorAsDecimalString } from "./money.ts"

export type ExportableLine = {
  /** The INV- tax invoice number: the document finance books in Bukku. */
  invoiceNumber: string
  /** The PI- proforma it settles, for tracing back to SIMS. */
  proformaNumber: string
  centralId: string | null
  paidAt: string | null
  companyName: string | null
  /** From the billing profile snapshotted on the invoice. */
  bukkuContactCode: string | null
  legalName: string | null
  franchiseId: string
  outletName: string | null
  outletId: string
  planName: string | null
  billingPlan: "annually" | "bi_annually"
  previousValidUntil: string | null
  effectiveMinor: number
  taxRatePercent: number
  paidVia: string | null
  capTransactionNumber: string | null
  /** The bank reference staff recorded for an offline payment. */
  paidReference: string | null
}

/** The template's columns, in order, spelled exactly as its `$` line spells them. */
export const BUKKU_INVOICE_COLUMNS = [
  "Contact Code (1)",
  "Legal Name (2)",
  "No. (3)",
  "Reference No.",
  "Date (D) *",
  "Payment Term (4)",
  "Due Date (D) (5)",
  "Currency (6)",
  "Rate (7)",
  "Tags (8)",
  "Title",
  "Description",
  "Product (9)",
  "Account (10) *",
  "Item Description *",
  "Quantity (11)",
  "UOM (12)",
  "Location (13)",
  "Unit Price *",
  "Discount (14)",
  "Tax (15)",
  "Classification Code (16)",
  "Field:sales_agent",
  "Field:outlet_id",
] as const

export type BukkuColumn = (typeof BUKKU_INVOICE_COLUMNS)[number]
export type BukkuRow = Record<BukkuColumn, string>

/** The Bukku codes every line carries, from Renewal Settings. */
export type BukkuCodes = {
  accountCode: string | null
  taxCode: string | null
  classificationCode: string | null
}

const TERM_MONTHS = { annually: 12, bi_annually: 6 } as const

/** `{plan} · {outlet} · {period}` with the configured format. */
export function describeLine(format: string | null, line: ExportableLine): string {
  const start = line.previousValidUntil?.slice(0, 10) ?? null
  const period = start
    ? `${start} to ${addMonths(start, TERM_MONTHS[line.billingPlan])}`
    : line.billingPlan === "annually" ? "12 months" : "6 months"
  const values: Record<string, string> = {
    plan: line.planName ?? "Slurp licence",
    outlet: line.outletName ?? `Outlet ${line.outletId}`,
    period,
    oid: line.outletId,
    term: line.billingPlan === "annually" ? "1 year" : "6 months",
  }
  const template = format?.trim() || "{plan} · {outlet} · {period}"
  return template.replace(/\{([a-zA-Z]+)\}/g, (match, name: string) =>
    name in values ? values[name] : match
  )
}

/** `2026-09-12…` as Bukku's `12/09/2026`. Read literally, so no timezone can shift it. */
export function bukkuDate(value: string | null | undefined): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value ?? "")
  return match ? `${match[3]}/${match[2]}/${match[1]}` : ""
}

function paymentNote(line: ExportableLine): string {
  const method = line.paidVia === "manual" ? "bank transfer" : "CommercePay"
  const reference = line.capTransactionNumber ?? line.paidReference
  return `Paid by ${method}${reference ? `, ref ${reference}` : ""}. Proforma ${line.proformaNumber}.`
}

export function buildBukkuRows(
  lines: readonly ExportableLine[],
  descriptionFormat: string | null,
  codes: BukkuCodes
): BukkuRow[] {
  const outletsPerInvoice = new Map<string, number>()
  for (const line of lines) {
    outletsPerInvoice.set(line.invoiceNumber, (outletsPerInvoice.get(line.invoiceNumber) ?? 0) + 1)
  }

  return lines.map((line) => {
    const name = line.legalName ?? line.companyName ?? `Franchise ${line.franchiseId}`
    const outlets = outletsPerInvoice.get(line.invoiceNumber) ?? 1
    const date = bukkuDate(line.paidAt)
    return {
      "Contact Code (1)": line.bukkuContactCode ?? "",
      "Legal Name (2)": name,
      "No. (3)": line.invoiceNumber,
      "Reference No.": line.proformaNumber,
      "Date (D) *": date,
      "Payment Term (4)": "",
      // Already paid, so due on the day it was issued.
      "Due Date (D) (5)": date,
      "Currency (6)": "MYR",
      "Rate (7)": "",
      "Tags (8)": "",
      Title: `(RN) ${name.toUpperCase()} @ ${outlets} ${outlets === 1 ? "OUTLET" : "OUTLETS"} - SLURP! LICENSE RENEWAL (${line.billingPlan === "annually" ? "YEARLY" : "BI-ANNUAL"})`,
      Description: paymentNote(line),
      "Product (9)": "",
      "Account (10) *": codes.accountCode ?? "",
      "Item Description *": describeLine(descriptionFormat, line),
      "Quantity (11)": "1",
      "UOM (12)": "",
      "Location (13)": "",
      "Unit Price *": formatMinorAsDecimalString(line.effectiveMinor),
      "Discount (14)": "",
      // Bukku works the tax out from its own code; at 0% there is none to name.
      "Tax (15)": line.taxRatePercent > 0 ? (codes.taxCode ?? "") : "",
      "Classification Code (16)": codes.classificationCode ?? "",
      "Field:sales_agent": "",
      "Field:outlet_id": line.outletId,
    }
  })
}

/**
 * The sheet as rows of cells, framed the way Bukku's importer reads it: `#`
 * comment lines, the `$` column line, then each row with an empty first cell.
 */
export function buildBukkuSheet(rows: readonly BukkuRow[], reference: string): string[][] {
  return [
    ["#", "TEMPLATE FOR INVOICES (CREDIT SALES) - EXTENDED MODE - MY"],
    ["#", `Generated by SIMS Renewals as ${reference}. Lines that start with '#' are comments.`],
    ["#", 'Dates are "DD/MM/YYYY". Each outlet is one line item; lines sharing a No. are one invoice.'],
    ["$", ...BUKKU_INVOICE_COLUMNS],
    ...rows.map((row) => ["", ...BUKKU_INVOICE_COLUMNS.map((column) => row[column])]),
  ]
}

/** `BKX-2026-08-003`: the month exported, then a running number. */
export function formatBatchReference(paidTo: string, sequence: number): string {
  return `BKX-${paidTo.slice(0, 7)}-${String(sequence).padStart(3, "0")}`
}

/** The previous calendar month as `[from, to]`, the export's default. */
export function previousMonthRange(today: string): { from: string; to: string } {
  const [year, month] = today.split("-").map(Number)
  const firstOfThisMonth = new Date(Date.UTC(year, month - 1, 1))
  const lastOfPrevious = new Date(firstOfThisMonth.getTime() - 86_400_000)
  const firstOfPrevious = new Date(Date.UTC(lastOfPrevious.getUTCFullYear(), lastOfPrevious.getUTCMonth(), 1))
  const iso = (date: Date) => date.toISOString().slice(0, 10)
  return { from: iso(firstOfPrevious), to: iso(lastOfPrevious) }
}
