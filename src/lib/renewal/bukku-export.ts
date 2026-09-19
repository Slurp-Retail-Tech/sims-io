/**
 * Shaping paid invoices into the rows Bukku imports.
 *
 * One row per invoice line item: a grouped invoice with six outlets is six
 * rows sharing an invoice number, because that is how the revenue is
 * recognised per outlet. Amounts are formatted from minor units here, once.
 *
 * The exact column set Bukku expects is an open dependency (PRD §8). These
 * columns follow Bukku's sales-invoice import and are named so a finance
 * user can map them; changing a header is a one-line edit.
 *
 * Pure and runtime-free so the shaping is unit-tested.
 */

import { addMonths } from "./invoice-build.ts"
import { formatMinorAsDecimalString } from "./money.ts"

export type ExportableLine = {
  invoiceNumber: string
  paidAt: string | null
  companyName: string | null
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
}

export type BukkuRow = Record<string, string>

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

export function buildBukkuRows(
  lines: readonly ExportableLine[],
  descriptionFormat: string | null
): BukkuRow[] {
  return lines.map((line) => {
    const taxMinor = Math.round((line.effectiveMinor * line.taxRatePercent) / 100)
    return {
      "Invoice Date": line.paidAt?.slice(0, 10) ?? "",
      "Invoice No": line.invoiceNumber,
      Customer: line.companyName ?? `Franchise ${line.franchiseId}`,
      "Customer Ref": line.franchiseId,
      Description: describeLine(descriptionFormat, line),
      Quantity: "1",
      "Unit Price": formatMinorAsDecimalString(line.effectiveMinor),
      "Tax Rate (%)": line.taxRatePercent.toFixed(2),
      "Tax Amount": formatMinorAsDecimalString(taxMinor),
      Total: formatMinorAsDecimalString(line.effectiveMinor + taxMinor),
      Currency: "MYR",
      "Payment Method": line.paidVia === "manual" ? "Bank transfer" : "CommercePay",
      "Payment Ref": line.capTransactionNumber ?? "",
    }
  })
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
