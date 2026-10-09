/**
 * What a renewal document says: the one source for the merchant's web page
 * and the printed PDF.
 *
 * The proforma, tax invoice and receipt are rendered twice: as the document
 * card on `/renew/{token}` and as a PDF. They used to be shaped separately,
 * and drifted: different column sets, different titles, "RM1,200.00" on paper
 * and "RM 1,200.00" on screen. Both now take their wording, figures and order
 * from here, and only decide how to draw it.
 *
 * Pure and runtime-free (no React, no database), so it is unit-tested and can
 * be imported by client components and the PDF renderer alike.
 */

export type DocumentKind = "proforma" | "tax_invoice" | "receipt"

export type DocumentSourceLine = {
  outletId: string
  outletName: string | null
  licensePlan: string | null
  /** The expiry this line renews from. */
  previousValidUntil: string | null
  /** The expiry it moved to, once extended; otherwise null. */
  newValidUntil: string | null
  catalogMinor: number | null
  adjustmentMinor: number
  amountMinor: number
}

/** Everything a document needs, from either the public view or the database. */
export type DocumentSource = {
  kind: DocumentKind
  /** The number this document carries: PI- for a proforma or receipt, INV- for a tax invoice. */
  invoiceNumber: string
  /** On a tax invoice: the proforma it settles. */
  proformaNumber?: string | null
  /** On a receipt: the tax invoice issued against the payment. */
  taxInvoiceNumber?: string | null
  issueDate: string | null
  dueDate: string | null
  paidAt: string | null
  paidVia: "commercepay" | "manual" | null
  paymentReference: string | null
  companyName: string | null
  franchiseId: string
  paymentEmail: string | null
  isGrouped: boolean
  outletCount: number
  term: string
  /** The invoice's projected period end, for lines not yet extended. */
  periodEnd: string | null
  currencyCode: string
  lines: readonly DocumentSourceLine[]
  totals: { subtotalMinor: number; taxRatePercent: number; taxMinor: number; totalMinor: number }
}

export type DocMetaRow = { label: string; value: string; mono?: boolean }

export type DocumentLineRow = {
  key: string
  no: string
  description: string
  outlet: string
  duration: string
  adjustmentNote: string | null
  qty: string
  unitPrice: string
  amount: string
}

export type DocumentContent = {
  docTypeTitle: string
  docMeta: DocMetaRow[]
  billTo: { name: string; lines: string[] }
  shipTo: { name: string; lines: string[] }
  docTitle: string
  lines: DocumentLineRow[]
  subtotal: string
  taxVisible: boolean
  taxLabel: string
  tax: string
  totalLabel: string
  total: string
  termsLines: readonly string[]
}

/** The three legal lines every renewal document carries. */
export const RENEWAL_TERMS_LINES: readonly string[] = [
  "Slurp! POS System is a cloud-based system with bi-annual/yearly subscription basis. Renewal is required to ensure the system is active and functional.",
  "Once renewed, payments are non-refundable.",
  "Accounts that are not renewed for more than 6 months will be permanently removed from our database and can not be recovered.",
]

export const DOC_TYPE_TITLES: Record<DocumentKind, string> = {
  proforma: "PROFORMA INVOICE",
  tax_invoice: "TAX INVOICE",
  receipt: "OFFICIAL RECEIPT",
}

const TERM_LABELS: Record<string, string> = { annually: "1 year", bi_annually: "6 months" }
const TERM_DOC_LABELS: Record<string, string> = { annually: "YEARLY", bi_annually: "BI-ANNUAL" }
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

/** `RM 8,400.00`, spaced as the design writes it. */
export function docMoney(minor: number | null | undefined, currency = "MYR"): string {
  if (minor === null || minor === undefined) {
    return "—"
  }
  const negative = minor < 0
  const absolute = Math.abs(minor)
  const whole = String(Math.trunc(absolute / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, ",")
  const prefix = currency === "MYR" ? "RM " : `${currency} `
  return `${negative ? "-" : ""}${prefix}${whole}.${String(absolute % 100).padStart(2, "0")}`
}

/**
 * `2026-10-02` (or a DATETIME starting with it) as `2 Oct 2026`. Read
 * literally, never through `Date`, so no timezone can shift it.
 */
export function docLongDate(value: string | null | undefined): string {
  if (!value) {
    return "—"
  }
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value)
  if (!match) {
    return value
  }
  return `${Number(match[3])} ${MONTHS[Number(match[2]) - 1] ?? match[2]} ${match[1]}`
}

function signedMoney(minor: number, currency: string): string {
  if (minor === 0) {
    return docMoney(0, currency)
  }
  const formatted = docMoney(Math.abs(minor), currency)
  return minor < 0 ? `-${formatted}` : `+${formatted}`
}

function termDocLabel(term: string): string {
  return TERM_DOC_LABELS[term] ?? term.toUpperCase()
}

export function buildBillTo(source: DocumentSource): { name: string; lines: string[] } {
  const lines: string[] = [`Franchise ID ${source.franchiseId}`]
  if (source.paymentEmail) {
    lines.push(source.paymentEmail)
  }
  return { name: source.companyName ?? `Franchise ${source.franchiseId}`, lines }
}

export function buildShipTo(source: DocumentSource): { name: string; lines: string[] } {
  const outletNames = source.lines.map((line) => line.outletName ?? `Outlet ${line.outletId}`)
  if (source.isGrouped) {
    return {
      name: `Outlet: ${source.outletCount} outlets, grouped`,
      lines: [outletNames.join(" · "), `FID ${source.franchiseId}`],
    }
  }
  const only = source.lines[0]
  return {
    name: `Outlet: ${outletNames[0] ?? `outlet ${only?.outletId ?? ""}`}`,
    lines: [`OID ${only?.outletId ?? "—"}`, `FID ${source.franchiseId}`],
  }
}

export function buildDocTitle(source: DocumentSource, suffix?: string): string {
  const who = (source.companyName ?? `FRANCHISE ${source.franchiseId}`).toUpperCase()
  const outlets = `${source.outletCount} ${source.outletCount === 1 ? "OUTLET" : "OUTLETS"}`
  return `(RN) ${who} @ ${outlets} - SLURP! LICENSE RENEWAL (${termDocLabel(source.term)})${suffix ? ` - ${suffix}` : ""}`
}

export function buildDocLines(source: DocumentSource): DocumentLineRow[] {
  const term = termDocLabel(source.term)
  return source.lines.map((line, index) => {
    const plan = (line.licensePlan ?? "SLURP").toUpperCase()
    // Before the licence is extended the line has no new expiry yet; the
    // invoice's projected period end is the date the term selector shows.
    const periodEnd = line.newValidUntil ?? source.periodEnd
    return {
      key: line.outletId,
      no: String(index + 1),
      description: `(RN) SLURP! ${plan} LICENSE RENEWAL (${term})`,
      outlet: `${(line.outletName ?? `OUTLET ${line.outletId}`).toUpperCase()} · OID ${line.outletId}`,
      duration: `Subscription period: ${docLongDate(line.previousValidUntil).toUpperCase()} – ${docLongDate(periodEnd).toUpperCase()}`,
      adjustmentNote: line.adjustmentMinor !== 0 ? `Adjustment ${signedMoney(line.adjustmentMinor, source.currencyCode)}` : null,
      qty: "1",
      unitPrice: docMoney(line.catalogMinor ?? line.amountMinor, source.currencyCode),
      amount: docMoney(line.amountMinor, source.currencyCode),
    }
  })
}

function paymentMethod(source: DocumentSource): string {
  return source.paidVia === "manual" ? "Bank transfer" : "CommercePay"
}

export function buildDocMeta(source: DocumentSource): DocMetaRow[] {
  const reference = source.paymentReference ? [{ label: "Reference", value: source.paymentReference, mono: true }] : []
  switch (source.kind) {
    case "proforma":
      return [
        { label: "No.", value: source.invoiceNumber, mono: true },
        { label: "Date", value: docLongDate(source.issueDate) },
        { label: "Due date", value: docLongDate(source.dueDate) },
        { label: "Term", value: TERM_LABELS[source.term] ?? source.term },
      ]
    case "receipt":
      return [
        { label: "No.", value: source.invoiceNumber, mono: true },
        { label: "Tax invoice", value: source.taxInvoiceNumber ?? "Pending", mono: Boolean(source.taxInvoiceNumber) },
        { label: "Date", value: docLongDate(source.paidAt) },
        { label: "Method", value: paymentMethod(source) },
        ...reference,
      ]
    case "tax_invoice":
      return [
        { label: "No.", value: source.invoiceNumber, mono: true },
        ...(source.proformaNumber ? [{ label: "Proforma", value: source.proformaNumber, mono: true }] : []),
        { label: "Date", value: docLongDate(source.issueDate) },
        { label: "Method", value: paymentMethod(source) },
        ...reference,
      ]
  }
}

/** The whole document, in reading order. */
export function buildDocumentContent(source: DocumentSource): DocumentContent {
  const currency = source.currencyCode
  return {
    docTypeTitle: DOC_TYPE_TITLES[source.kind],
    docMeta: buildDocMeta(source),
    billTo: buildBillTo(source),
    shipTo: buildShipTo(source),
    docTitle: buildDocTitle(source, source.kind === "proforma" ? undefined : "PAID"),
    lines: buildDocLines(source),
    subtotal: docMoney(source.totals.subtotalMinor, currency),
    taxVisible: source.totals.taxRatePercent > 0,
    taxLabel: `SST ${source.totals.taxRatePercent}% (exclusive)`,
    tax: docMoney(source.totals.taxMinor, currency),
    totalLabel: source.kind === "proforma" ? "Total due" : "Total paid",
    total: docMoney(source.totals.totalMinor, currency),
    termsLines: RENEWAL_TERMS_LINES,
  }
}
