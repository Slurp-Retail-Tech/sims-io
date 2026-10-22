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

/**
 * What the pre-payment document is called. A quotation is a proforma in
 * every respect but its title and number, for companies that will only pay
 * against one.
 */
export type IssuedAs = "proforma" | "quotation"

/**
 * The registered customer printed under Bill To: the franchise's billing
 * profile, matched from Bukku or entered by staff. Every field is optional;
 * a franchise with no profile prints its company name alone.
 */
export type BillToDetails = {
  legalName: string | null
  /** Bukku's Reg. No. Type: BRN (an SSM number), NRIC or PASSPORT. */
  regNoType: string | null
  registrationNo: string | null
  oldRegistrationNo: string | null
  tin: string | null
  sstNo: string | null
  street: string | null
  city: string | null
  state: string | null
  postcode: string | null
  country: string | null
}

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
  /** The number this document carries: PI- or QT- for a proforma or receipt, INV- for a tax invoice. */
  invoiceNumber: string
  /**
   * What the pre-payment document was issued as. On a proforma or receipt,
   * this document; on a tax invoice, the one it settles. Defaults to proforma.
   */
  issuedAs?: IssuedAs
  /** The merchant's purchase order number, printed on every document of the renewal. */
  poNumber?: string | null
  /** On a tax invoice: the proforma (or quotation) it settles. */
  proformaNumber?: string | null
  /** On a receipt: the tax invoice issued against the payment. */
  taxInvoiceNumber?: string | null
  issueDate: string | null
  dueDate: string | null
  paidAt: string | null
  paidVia: "commercepay" | "manual" | null
  paymentReference: string | null
  companyName: string | null
  /** The billing profile snapshotted on the document; null prints the company name alone. */
  billTo?: BillToDetails | null
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

/** The document's title: QUOTATION for a proforma issued as one. */
export function docTypeTitle(source: Pick<DocumentSource, "kind" | "issuedAs">): string {
  return source.kind === "proforma" && source.issuedAs === "quotation" ? "QUOTATION" : DOC_TYPE_TITLES[source.kind]
}

/** `proforma` or `quotation`, as running text calls it. */
export function documentLabel(issuedAs: IssuedAs | null | undefined): string {
  return issuedAs === "quotation" ? "quotation" : "proforma"
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

/** The name a document is addressed to: the registered name where known. */
export function billToName(source: Pick<DocumentSource, "billTo" | "companyName" | "franchiseId">): string {
  return source.billTo?.legalName?.trim() || source.companyName || `Franchise ${source.franchiseId}`
}

const REGISTRATION_LABELS: Record<string, string> = { BRN: "SSM", NRIC: "NRIC", PASSPORT: "Passport" }

/** `SSM 202103124055 (TR0241344-W)`: the new-format number, then the old one. */
export function registrationLine(details: BillToDetails): string | null {
  const numbers = [details.registrationNo, details.oldRegistrationNo].map((value) => value?.trim()).filter(Boolean)
  if (numbers.length === 0) {
    return null
  }
  const label = REGISTRATION_LABELS[details.regNoType?.toUpperCase() ?? ""] ?? "SSM"
  const [first, second] = numbers
  return `${label} ${first}${second && second !== first ? ` (${second})` : ""}`
}

/**
 * The billing address as printed lines, at most four.
 *
 * Bukku's street cells are free text typed over years: trailing commas, an
 * `Email:` line, the outlet's trading name above the address. Email lines and
 * empty lines go; the postcode, city and state are appended unless the street
 * already spells them out.
 */
export function addressLines(details: BillToDetails): string[] {
  const street = (details.street ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim().replace(/[\s,]+$/, "").replace(/^[\s,]+/, ""))
    .filter((line) => line.length > 0 && !line.includes("@"))
  const lines = [...street]
  const written = street.join(" ").toUpperCase()
  const locality = [details.postcode, details.city]
    .map((value) => value?.trim())
    .filter((value): value is string => Boolean(value) && !written.includes(value!.toUpperCase()))
    .join(" ")
  if (locality) {
    lines.push(locality)
  }
  const state = details.state?.trim()
  if (state && !written.includes(state.toUpperCase())) {
    lines.push(state)
  }
  const country = details.country?.trim().toUpperCase()
  if (country && country !== "MY" && !written.includes(country)) {
    lines.push(country)
  }
  if (lines.length <= 4) {
    return lines
  }
  return [...lines.slice(0, 3), lines.slice(3).join(", ")]
}

export function buildBillTo(source: DocumentSource): { name: string; lines: string[] } {
  const lines: string[] = []
  const details = source.billTo
  if (details) {
    const registration = registrationLine(details)
    if (registration) lines.push(registration)
    if (details.tin?.trim()) lines.push(`TIN ${details.tin.trim()}`)
    if (details.sstNo?.trim()) lines.push(`SST ${details.sstNo.trim()}`)
    lines.push(...addressLines(details))
  }
  if (source.paymentEmail) {
    lines.push(source.paymentEmail)
  }
  return { name: billToName(source), lines }
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
  const who = billToName(source).toUpperCase()
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
  const po = source.poNumber?.trim() ? [{ label: "PO No.", value: source.poNumber.trim(), mono: true }] : []
  const quotation = source.issuedAs === "quotation"
  switch (source.kind) {
    case "proforma":
      return [
        { label: "No.", value: source.invoiceNumber, mono: true },
        ...po,
        { label: "Date", value: docLongDate(source.issueDate) },
        // A quotation is an offer: its due date is how long the price holds.
        { label: quotation ? "Valid until" : "Due date", value: docLongDate(source.dueDate) },
        { label: "Term", value: TERM_LABELS[source.term] ?? source.term },
      ]
    case "receipt":
      return [
        { label: "No.", value: source.invoiceNumber, mono: true },
        ...po,
        { label: "Tax invoice", value: source.taxInvoiceNumber ?? "Pending", mono: Boolean(source.taxInvoiceNumber) },
        { label: "Date", value: docLongDate(source.paidAt) },
        { label: "Method", value: paymentMethod(source) },
        ...reference,
      ]
    case "tax_invoice":
      return [
        { label: "No.", value: source.invoiceNumber, mono: true },
        ...(source.proformaNumber
          ? [{ label: quotation ? "Quotation" : "Proforma", value: source.proformaNumber, mono: true }]
          : []),
        ...po,
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
    docTypeTitle: docTypeTitle(source),
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
