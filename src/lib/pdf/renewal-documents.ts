/**
 * The renewal documents: proforma invoice, tax invoice, receipt.
 *
 * One renderer, parameterised by title and by which blocks appear, so the
 * three documents share a layout and a merchant recognises the second one
 * from the first. Takes a plain document model rather than database rows, so
 * it can be rendered in a test with no database and no storage.
 *
 * Amounts arrive in minor units and are formatted here, once, through the
 * same helper the UI uses, so the PDF and the page can never disagree on a
 * figure.
 */

import { PDFDocument } from "pdf-lib"

import { formatMinorForDisplay } from "../renewal/money.ts"
import { COLORS, PdfWriter, embedStandardFonts } from "./layout.ts"

export type RenewalDocumentKind = "proforma" | "tax_invoice" | "receipt"

export type DocumentLine = {
  outletName: string | null
  outletId: string
  licensePlan: string | null
  /** "1 year" or "6 months". */
  termLabel: string
  /** YYYY-MM-DD, or null when unknown. */
  periodStart: string | null
  periodEnd: string | null
  catalogMinor: number | null
  adjustmentMinor: number
  amountMinor: number
}

export type RenewalDocument = {
  kind: RenewalDocumentKind
  invoiceNumber: string
  /** For a tax invoice or receipt: the proforma it settles. */
  referenceNumber?: string | null
  issueDate: string | null
  dueDate: string | null
  paidAt?: string | null
  paymentReference?: string | null
  currencyCode: string
  billTo: {
    companyName: string | null
    franchiseId: string
    contactName?: string | null
    email?: string | null
  }
  seller: {
    name: string
    lines: readonly string[]
  }
  lines: readonly DocumentLine[]
  totals: {
    subtotalMinor: number
    adjustmentMinor: number
    taxRatePercent: number
    taxMinor: number
    totalMinor: number
  }
  /** The merchant-facing link, printed on a proforma so a paper copy still pays. */
  payLink?: string | null
  notes?: readonly string[]
}

const TITLES: Record<RenewalDocumentKind, string> = {
  proforma: "PROFORMA INVOICE",
  tax_invoice: "TAX INVOICE",
  receipt: "PAYMENT RECEIPT",
}

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
]

/**
 * `2026-10-15` or `2026-10-15 03:14:00.000` as `15 Oct 2026`.
 *
 * Reads the leading date only and never goes through `Date`, so a DATETIME
 * stored in UTC is not shifted by the renderer's own timezone.
 */
export function formatDocumentDate(value: string | null | undefined): string {
  if (!value) {
    return "-"
  }
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value)
  if (!match) {
    return value
  }
  const month = MONTHS[Number(match[2]) - 1] ?? match[2]
  return `${Number(match[3])} ${month} ${match[1]}`
}

function formatMoney(minor: number, currency: string): string {
  return formatMinorForDisplay(minor, currency)
}

function formatSignedMoney(minor: number, currency: string): string {
  if (minor === 0) {
    return "-"
  }
  const formatted = formatMoney(Math.abs(minor), currency)
  return minor < 0 ? `-${formatted}` : `+${formatted}`
}

/**
 * Render a renewal document to PDF bytes.
 *
 * Layout, top to bottom: seller and document title; bill-to and document
 * facts side by side; the outlet table; totals aligned right; payment block
 * (proforma) or payment confirmation (receipt, tax invoice); notes; footer.
 */
export async function renderRenewalDocument(
  document: RenewalDocument
): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  doc.setTitle(`${TITLES[document.kind]} ${document.invoiceNumber}`)
  doc.setProducer("SIMS")
  doc.setCreator("SIMS Renewal")

  const fonts = await embedStandardFonts(doc)
  const writer = new PdfWriter(doc, fonts)
  const currency = document.currencyCode

  writer.setContinuationHeader((w) => {
    w.line(`${TITLES[document.kind]} ${document.invoiceNumber} (continued)`, w.left, {
      size: 9,
      color: COLORS.muted,
    })
    w.moveDown(6)
  })

  // --- Header: seller left, title right --------------------------------
  const headerTop = writer.y
  writer.line(document.seller.name, writer.left, { size: 16, bold: true })
  for (const line of document.seller.lines) {
    writer.line(line, writer.left, { size: 9, color: COLORS.muted })
  }
  const sellerBottom = writer.y

  writer.y = headerTop
  writer.line(TITLES[document.kind], writer.left, {
    size: 14,
    bold: true,
    width: writer.contentWidth,
    align: "right",
    color: COLORS.accent,
  })
  writer.line(document.invoiceNumber, writer.left, {
    size: 12,
    width: writer.contentWidth,
    align: "right",
  })
  if (document.referenceNumber) {
    writer.line(`Ref. ${document.referenceNumber}`, writer.left, {
      size: 9,
      color: COLORS.muted,
      width: writer.contentWidth,
      align: "right",
    })
  }
  writer.y = Math.max(writer.y, sellerBottom) + 10
  writer.rule()
  writer.moveDown(10)

  // --- Bill to (left) and facts (right) ---------------------------------
  const columnGap = 24
  const columnWidth = (writer.contentWidth - columnGap) / 2
  const factsX = writer.left + columnWidth + columnGap
  const blockTop = writer.y

  writer.line("BILL TO", writer.left, { size: 8, bold: true, color: COLORS.muted })
  writer.paragraph(
    document.billTo.companyName ?? `Franchise ${document.billTo.franchiseId}`,
    writer.left,
    { size: 11, bold: true, width: columnWidth }
  )
  writer.line(`Franchise ID ${document.billTo.franchiseId}`, writer.left, {
    size: 9,
    color: COLORS.muted,
  })
  if (document.billTo.contactName) {
    writer.line(`Attn: ${document.billTo.contactName}`, writer.left, { size: 9 })
  }
  if (document.billTo.email) {
    writer.line(document.billTo.email, writer.left, { size: 9, color: COLORS.muted })
  }
  const billToBottom = writer.y

  writer.y = blockTop
  const facts: Array<[string, string]> = [
    ["Issue date", formatDocumentDate(document.issueDate)],
  ]
  if (document.kind === "proforma") {
    facts.push(["Due date", formatDocumentDate(document.dueDate)])
  }
  if (document.paidAt) {
    facts.push(["Paid on", formatDocumentDate(document.paidAt)])
  }
  if (document.paymentReference) {
    facts.push(["Payment ref.", document.paymentReference])
  }
  facts.push(["Currency", currency])
  for (const [label, value] of facts) {
    writer.keyValue(label, value, factsX, writer.right, { size: 9 })
  }

  writer.y = Math.max(writer.y, billToBottom) + 16

  // --- Lines -------------------------------------------------------------
  const tableWidth = writer.contentWidth
  const moneyWidth = 78
  const termWidth = 62
  const periodWidth = 118
  const outletWidth = tableWidth - termWidth - periodWidth - moneyWidth * 3

  writer.table({
    columns: [
      { label: "Outlet", width: outletWidth },
      { label: "Term", width: termWidth },
      { label: "Period", width: periodWidth },
      { label: "Catalog", width: moneyWidth, align: "right" },
      { label: "Adjustment", width: moneyWidth, align: "right" },
      { label: "Amount", width: moneyWidth, align: "right" },
    ],
    rows: document.lines.map((line) => [
      `${line.outletName ?? `Outlet ${line.outletId}`}  (${line.outletId})` +
        (line.licensePlan ? `\n${capitalise(line.licensePlan)} plan` : ""),
      line.termLabel,
      `${formatDocumentDate(line.periodStart)} to ${formatDocumentDate(line.periodEnd)}`,
      line.catalogMinor === null ? "-" : formatMoney(line.catalogMinor, currency),
      formatSignedMoney(line.adjustmentMinor, currency),
      formatMoney(line.amountMinor, currency),
    ]),
  })

  // --- Totals -----------------------------------------------------------
  writer.moveDown(6)
  const totalsX = writer.right - 240
  writer.keyValue(
    "Subtotal",
    formatMoney(document.totals.subtotalMinor, currency),
    totalsX,
    writer.right,
    { size: 10 }
  )
  if (document.totals.adjustmentMinor !== 0) {
    writer.keyValue(
      document.totals.adjustmentMinor < 0 ? "Reductions included" : "Increases included",
      formatSignedMoney(document.totals.adjustmentMinor, currency),
      totalsX,
      writer.right,
      { size: 9, color: COLORS.muted }
    )
  }
  if (document.totals.taxRatePercent > 0) {
    writer.keyValue(
      `Tax (${document.totals.taxRatePercent}%)`,
      formatMoney(document.totals.taxMinor, currency),
      totalsX,
      writer.right,
      { size: 10 }
    )
  }
  writer.keyValue(
    document.kind === "receipt" ? "Total paid" : "Total due",
    formatMoney(document.totals.totalMinor, currency),
    totalsX,
    writer.right,
    { size: 12, bold: true }
  )

  writer.moveDown(18)

  // --- Payment block -----------------------------------------------------
  if (document.kind === "proforma" && document.payLink) {
    writer.rule()
    writer.moveDown(8)
    writer.line("HOW TO PAY", writer.left, { size: 8, bold: true, color: COLORS.muted })
    writer.paragraph(
      "Open the secure renewal link below to review the outlets, choose a term and pay online. The licence extends automatically once payment is confirmed.",
      writer.left,
      { size: 9.5 }
    )
    writer.moveDown(4)
    writer.paragraph(document.payLink, writer.left, { size: 9, color: COLORS.accent })
    writer.moveDown(10)
  }

  if (document.kind !== "proforma") {
    writer.rule()
    writer.moveDown(8)
    writer.paragraph(
      document.kind === "receipt"
        ? "Payment received with thanks. Each outlet's licence has been extended from its previous expiry date for the term shown."
        : "This tax invoice is issued against the payment received for the proforma referenced above.",
      writer.left,
      { size: 9.5 }
    )
    writer.moveDown(10)
  }

  // --- Notes -------------------------------------------------------------
  if (document.notes && document.notes.length > 0) {
    writer.line("NOTES", writer.left, { size: 8, bold: true, color: COLORS.muted })
    for (const note of document.notes) {
      writer.paragraph(note, writer.left, { size: 9, color: COLORS.muted })
    }
  }

  writer.finishWithFooter(
    (page, count) =>
      `${TITLES[document.kind]} ${document.invoiceNumber}  ·  Generated by SIMS  ·  Page ${page} of ${count}`
  )

  return doc.save()
}

function capitalise(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1)
}
