/**
 * The printed renewal documents: proforma invoice, tax invoice, receipt.
 *
 * Drawn to match the document card on the merchant's renewal page: the Slurp
 * logo, then letterhead beside the document facts, Bill To and Ship To, the
 * renewal title, a light No. / Description / Qty / U/Price / Amt table,
 * totals with the total set large, and the terms. What it says (every
 * label, figure and line) comes from `document-content.ts`, the module the
 * page reads too, so the paper copy and the screen cannot disagree.
 *
 * Takes a plain document model rather than database rows, so it renders in a
 * test with no database and no storage.
 */

import { PDFDocument } from "pdf-lib"
import type { PDFImage } from "pdf-lib"

import { docLongDate } from "../renewal/document-content.ts"
import type { DocumentContent, DocumentKind, DocumentLineRow } from "../renewal/document-content.ts"
import { COLORS, PdfWriter, embedStandardFonts, wrapText } from "./layout.ts"

export type RenewalDocumentKind = DocumentKind

export type RenewalDocument = {
  kind: DocumentKind
  /** Used in the PDF title and footer. */
  invoiceNumber: string
  /** What the document says; see `buildDocumentContent`. */
  content: DocumentContent
  /** The letterhead; see `sellerBlockFor`. */
  seller: { name: string; lines: readonly string[] }
  /** The merchant-facing link, printed on a proforma so a paper copy still pays. */
  payLink?: string | null
  /** A line under the totals: what a paid document confirms. */
  closingNote?: string | null
  /** PNG bytes of the Slurp logo, drawn top left as on the page. Optional. */
  logo?: Uint8Array | null
}

/**
 * `2026-10-15` or `2026-10-15 03:14:00.000` as `15 Oct 2026`, `-` when empty.
 * Kept for the payer email, which formats its dates the same way.
 */
export function formatDocumentDate(value: string | null | undefined): string {
  return value ? docLongDate(value) : "-"
}

// Type scale, in points, matched to the page at print size.
const SIZE = {
  label: 7.5,
  small: 8.5,
  body: 9.5,
  heading: 11,
  total: 17,
} as const

/** The logo's height on the page; its width follows the image's aspect. */
const LOGO_HEIGHT = 22

/**
 * Render a renewal document to PDF bytes.
 */
export async function renderRenewalDocument(document: RenewalDocument): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  const { content } = document
  doc.setTitle(`${content.docTypeTitle} ${document.invoiceNumber}`)
  doc.setProducer("SIMS")
  doc.setCreator("SIMS Renewal")

  const fonts = await embedStandardFonts(doc)
  const writer = new PdfWriter(doc, fonts)
  const logo = await embedLogo(doc, document.logo)

  writer.setContinuationHeader((w) => {
    w.line(`${content.docTypeTitle} ${document.invoiceNumber} (continued)`, w.left, {
      size: SIZE.small,
      color: COLORS.muted,
    })
    w.moveDown(6)
  })

  // --- Logo, as the page's header shows it --------------------------------
  if (logo) {
    const width = (logo.width / logo.height) * LOGO_HEIGHT
    writer.page.drawImage(logo, {
      x: writer.left,
      y: writer.pageHeight - writer.y - LOGO_HEIGHT,
      width,
      height: LOGO_HEIGHT,
    })
    writer.moveDown(LOGO_HEIGHT + 22)
  }

  const gap = 24
  const half = (writer.contentWidth - gap) / 2
  const rightX = writer.left + half + gap

  // --- Letterhead (left) and document facts (right) -----------------------
  const headerTop = writer.y
  writer.paragraph(document.seller.name, writer.left, { size: SIZE.heading, bold: true, width: half })
  writer.moveDown(1)
  for (const line of document.seller.lines) {
    writer.paragraph(line, writer.left, { size: SIZE.small, color: COLORS.muted, width: half, lineHeight: SIZE.small * 1.5 })
  }
  const sellerBottom = writer.y

  writer.y = headerTop
  writer.line(content.docTypeTitle, rightX, { size: SIZE.heading, bold: true })
  writer.moveDown(3)
  for (const row of content.docMeta) {
    const rowTop = writer.y
    writer.line(row.label, rightX, { size: SIZE.body, color: COLORS.muted, lineHeight: SIZE.body * 1.75 })
    writer.y = rowTop
    writer.line(row.value, rightX, {
      size: SIZE.body,
      mono: row.mono,
      width: half,
      align: "right",
      lineHeight: SIZE.body * 1.75,
    })
  }
  writer.y = Math.max(writer.y, sellerBottom) + 12
  writer.rule()
  writer.moveDown(12)

  // --- Bill To and Ship To --------------------------------------------------
  const partiesTop = writer.y
  drawParty(writer, "BILL TO", content.billTo, writer.left, half)
  const billBottom = writer.y
  writer.y = partiesTop
  drawParty(writer, "SHIP TO", content.shipTo, rightX, half)
  writer.y = Math.max(writer.y, billBottom) + 10
  writer.rule()
  writer.moveDown(12)

  // --- Renewal title and line items -----------------------------------------
  writer.paragraph(content.docTitle, writer.left, { size: SIZE.body, bold: true })
  writer.moveDown(6)
  drawLineItems(writer, content.lines)

  // --- Totals ----------------------------------------------------------------
  writer.moveDown(6)
  totalRow(writer, "Subtotal", content.subtotal)
  if (content.taxVisible) {
    totalRow(writer, content.taxLabel, content.tax)
  }
  writer.moveDown(2)
  writer.rule()
  writer.moveDown(6)
  const totalTop = writer.y
  writer.line(content.totalLabel, writer.left, { size: SIZE.body + 0.5, bold: true, lineHeight: SIZE.total * 1.3 })
  writer.y = totalTop - 5
  writer.line(content.total, writer.left, {
    size: SIZE.total,
    bold: true,
    width: writer.contentWidth,
    align: "right",
    lineHeight: SIZE.total * 1.3,
  })
  writer.moveDown(10)

  // --- How to pay (proforma) or what was paid --------------------------------
  if (document.payLink) {
    writer.rule()
    writer.moveDown(10)
    sectionLabel(writer, "HOW TO PAY")
    writer.paragraph(
      "Open the secure renewal link below to review the outlets, choose a 1-year or 6-month term and pay online. The licence extends automatically once payment is confirmed.",
      writer.left,
      { size: SIZE.body, color: COLORS.muted }
    )
    writer.moveDown(2)
    writer.paragraph(document.payLink, writer.left, { size: SIZE.body, color: COLORS.accent })
    writer.moveDown(10)
  } else if (document.closingNote) {
    writer.rule()
    writer.moveDown(10)
    writer.paragraph(document.closingNote, writer.left, { size: SIZE.body, color: COLORS.muted })
    writer.moveDown(10)
  }

  // --- Terms & conditions -------------------------------------------------------
  writer.rule()
  writer.moveDown(10)
  sectionLabel(writer, "TERMS & CONDITIONS")
  for (const line of content.termsLines) {
    writer.paragraph(line, writer.left, { size: SIZE.small, color: COLORS.muted, lineHeight: SIZE.small * 1.45 })
    writer.moveDown(2)
  }

  writer.finishWithFooter(
    (page, count) => `${content.docTypeTitle} ${document.invoiceNumber}  ·  Generated by SIMS  ·  Page ${page} of ${count}`
  )

  return doc.save()
}

async function embedLogo(doc: PDFDocument, bytes: Uint8Array | null | undefined): Promise<PDFImage | null> {
  if (!bytes || bytes.byteLength === 0) {
    return null
  }
  try {
    return await doc.embedPng(bytes)
  } catch {
    // A logo that will not decode must not cost the merchant their document.
    return null
  }
}

/** Small uppercase grey label, as the page sets "BILL TO" and the column heads. */
function sectionLabel(writer: PdfWriter, text: string, x = writer.left): void {
  writer.line(text, x, { size: SIZE.label, color: COLORS.muted, lineHeight: SIZE.label * 1.9 })
}

function drawParty(
  writer: PdfWriter,
  label: string,
  party: { name: string; lines: readonly string[] },
  x: number,
  width: number
): void {
  sectionLabel(writer, label, x)
  writer.paragraph(party.name, x, { size: SIZE.body + 0.5, bold: true, width })
  for (const line of party.lines) {
    writer.paragraph(line, x, { size: SIZE.small + 0.5, color: COLORS.muted, width, lineHeight: (SIZE.small + 0.5) * 1.5 })
  }
}

function totalRow(writer: PdfWriter, label: string, value: string): void {
  const top = writer.y
  writer.line(label, writer.left, { size: SIZE.body + 0.5, color: COLORS.muted, lineHeight: SIZE.body * 2 })
  writer.y = top
  writer.line(value, writer.left, {
    size: SIZE.body + 0.5,
    color: COLORS.muted,
    width: writer.contentWidth,
    align: "right",
    lineHeight: SIZE.body * 2,
  })
}

/**
 * The line items, laid out like the page's table: a light uppercase header,
 * then per outlet the description in bold with its outlet, period and any
 * adjustment beneath in grey, and quantity, unit price and amount on the
 * right. A row never splits across pages; the header repeats on a new page.
 */
function drawLineItems(writer: PdfWriter, lines: readonly DocumentLineRow[]): void {
  const noWidth = 24
  const qtyWidth = 30
  const moneyWidth = 82
  const descX = writer.left + noWidth
  const descWidth = writer.contentWidth - noWidth - qtyWidth - moneyWidth * 2 - 12
  const qtyRight = descX + descWidth + 6 + qtyWidth
  const priceRight = qtyRight + moneyWidth
  const amountRight = writer.right

  const header = () => {
    const top = writer.y
    sectionLabel(writer, "NO.", writer.left)
    for (const [label, right, width] of [
      ["QTY", qtyRight, qtyWidth],
      ["U/PRICE", priceRight, moneyWidth],
      ["AMT", amountRight, moneyWidth],
    ] as const) {
      writer.y = top
      writer.line(label, right - width, { size: SIZE.label, color: COLORS.muted, width, align: "right", lineHeight: SIZE.label * 1.9 })
    }
    writer.y = top
    sectionLabel(writer, "DESCRIPTION", descX)
    writer.rule()
    writer.moveDown(4)
  }

  header()
  const descLineHeight = SIZE.body * 1.4
  const subLineHeight = SIZE.small * 1.45

  for (const line of lines) {
    const subLines = [line.outlet, line.duration, line.adjustmentNote].filter((text): text is string => Boolean(text))
    const descLines = wrapText(line.description, writer.fonts.bold, SIZE.body, descWidth).length
    const subCount = subLines.reduce(
      (count, text) => count + wrapText(text, writer.fonts.regular, SIZE.small, descWidth).length,
      0
    )
    const height = descLines * descLineHeight + subCount * subLineHeight + 14

    const pagesBefore = writer.pages
    writer.ensureSpace(height)
    if (writer.pages !== pagesBefore) {
      header()
    }

    const top = writer.y
    writer.line(line.no, writer.left, { size: SIZE.body, color: COLORS.muted, lineHeight: descLineHeight })
    for (const [text, right, width] of [
      [line.qty, qtyRight, qtyWidth],
      [line.unitPrice, priceRight, moneyWidth],
      [line.amount, amountRight, moneyWidth],
    ] as const) {
      writer.y = top
      writer.line(text, right - width, { size: SIZE.body, width, align: "right", lineHeight: descLineHeight })
    }
    writer.y = top
    writer.paragraph(line.description, descX, { size: SIZE.body, bold: true, width: descWidth, lineHeight: descLineHeight })
    for (const text of subLines) {
      writer.paragraph(text, descX, { size: SIZE.small, color: COLORS.muted, width: descWidth, lineHeight: subLineHeight })
    }
    writer.moveDown(6)
    writer.rule()
    writer.moveDown(4)
  }
}
