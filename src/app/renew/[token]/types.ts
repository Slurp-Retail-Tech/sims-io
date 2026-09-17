/**
 * The shape `GET /api/public/renewal/{token}` returns, re-declared for the
 * client bundle. Mirrors `PublicInvoiceView` in `src/lib/renewal/public-invoice.ts`.
 */

export type BillingTerm = "annually" | "bi_annually"

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

export type PublicPayment = {
  state: "none" | "pending" | "paid" | "failed" | "expired"
  redirectUrl: string | null
  expiresAt: string | null
  paidAt: string | null
}

export type TermQuote = {
  term: BillingTerm
  termMonths: number
  totalMinor: number
  periodEnd: string | null
}

export type PublicInvoice = {
  invoiceNumber: string
  status: string
  payability: "payable" | "paid" | "lapsed" | "closed"
  outletCount: number
  termQuotes: TermQuote[]
  documents: { proforma: boolean; receipt: boolean; taxInvoice: boolean }
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
  totals: {
    subtotalMinor: number
    adjustmentMinor: number
    taxMinor: number
    totalMinor: number
  }
  taxRatePercent: number
  paymentEmail: string | null
  payment: PublicPayment
  isGrouped: boolean
}

export async function fetchPublicInvoice(
  token: string
): Promise<{ ok: true; view: PublicInvoice } | { ok: false; status: number }> {
  const response = await fetch(`/api/public/renewal/${encodeURIComponent(token)}`, {
    cache: "no-store",
  })
  if (!response.ok) {
    return { ok: false, status: response.status }
  }
  return { ok: true, view: (await response.json()) as PublicInvoice }
}
