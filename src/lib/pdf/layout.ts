/**
 * A small layout layer over pdf-lib.
 *
 * pdf-lib gives primitives only: a page, a font, `drawText` at an absolute
 * coordinate. Everything else -- a cursor that moves down the page, text that
 * wraps at a width, a table that breaks across pages -- has to be built. This
 * is that, kept deliberately small: enough for an invoice, a receipt and a
 * report, and nothing speculative.
 *
 * Standard fonts only. They cover Latin-1, which is what invoice text needs,
 * and embedding a TrueType font would add a binary asset to the repository
 * for no gain. Anything outside Latin-1 is replaced before it reaches the
 * page rather than throwing mid-render.
 *
 * Coordinates: pdf-lib's origin is bottom-left. The writer hides that behind a
 * top-down cursor so callers reason in "how far down the page am I".
 */

import { PDFDocument, PDFFont, PDFPage, StandardFonts, rgb } from "pdf-lib"
import type { RGB } from "pdf-lib"

/** A4 portrait, in points. */
export const A4 = { width: 595.28, height: 841.89 } as const

export type PdfColor = RGB

export const COLORS = {
  ink: rgb(0.11, 0.11, 0.12),
  muted: rgb(0.45, 0.45, 0.48),
  rule: rgb(0.85, 0.85, 0.87),
  zebra: rgb(0.965, 0.965, 0.97),
  headerBand: rgb(0.13, 0.13, 0.14),
  white: rgb(1, 1, 1),
  accent: rgb(0.86, 0.2, 0.2),
} as const

export type TextOptions = {
  size?: number
  bold?: boolean
  color?: PdfColor
  /** Right edge for `align: "right"`, or the wrap width otherwise. */
  width?: number
  align?: "left" | "right"
  lineHeight?: number
}

export type TableColumn = {
  label: string
  /** Width in points. Columns are laid out left to right. */
  width: number
  align?: "left" | "right"
}

export type TableOptions = {
  columns: readonly TableColumn[]
  rows: readonly (readonly string[])[]
  fontSize?: number
  rowPadding?: number
  /** Called when a page break happens inside the table, after the header. */
  zebra?: boolean
}

/**
 * Replace anything the standard fonts cannot encode.
 *
 * WinAnsi covers Latin-1. A stray emoji or a CJK outlet name would otherwise
 * make `drawText` throw halfway through the document.
 */
export function sanitizePdfText(value: string): string {
  return value.replace(/[^\x09\x0A\x0D\x20-\x7E\xA0-\xFF]/g, "?")
}

/**
 * Break text into lines that fit `maxWidth` at `size`.
 *
 * Word-wraps on spaces; a single word wider than the column is hard-broken so
 * a long outlet name cannot escape its cell.
 */
export function wrapText(
  text: string,
  font: PDFFont,
  size: number,
  maxWidth: number
): string[] {
  const clean = sanitizePdfText(text).replace(/\s+/g, " ").trim()
  if (!clean) {
    return [""]
  }

  const lines: string[] = []
  let current = ""

  const fits = (candidate: string) => font.widthOfTextAtSize(candidate, size) <= maxWidth

  for (const word of clean.split(" ")) {
    const candidate = current ? `${current} ${word}` : word
    if (fits(candidate)) {
      current = candidate
      continue
    }
    if (current) {
      lines.push(current)
      current = ""
    }
    if (fits(word)) {
      current = word
      continue
    }
    // Hard-break an over-wide word.
    let chunk = ""
    for (const char of word) {
      if (fits(chunk + char)) {
        chunk += char
      } else {
        lines.push(chunk)
        chunk = char
      }
    }
    current = chunk
  }

  if (current) {
    lines.push(current)
  }
  return lines
}

export type PdfFonts = { regular: PDFFont; bold: PDFFont }

export async function embedStandardFonts(doc: PDFDocument): Promise<PdfFonts> {
  const [regular, bold] = await Promise.all([
    doc.embedFont(StandardFonts.Helvetica),
    doc.embedFont(StandardFonts.HelveticaBold),
  ])
  return { regular, bold }
}

/**
 * Top-down page writer.
 *
 * `y` is the distance from the top of the page to the current baseline. Every
 * method draws at the cursor and moves it, so a document reads as a sequence
 * of "write this, then this", and a page break is a detail the writer handles.
 */
export class PdfWriter {
  readonly doc: PDFDocument
  readonly fonts: PdfFonts
  readonly pageWidth: number
  readonly pageHeight: number
  readonly margin: number
  page: PDFPage
  /** Distance from the top of the page to the cursor. */
  y: number
  private pageCount = 0
  private onNewPage: ((writer: PdfWriter) => void) | null = null

  constructor(
    doc: PDFDocument,
    fonts: PdfFonts,
    options: { margin?: number; pageWidth?: number; pageHeight?: number } = {}
  ) {
    this.doc = doc
    this.fonts = fonts
    this.margin = options.margin ?? 48
    this.pageWidth = options.pageWidth ?? A4.width
    this.pageHeight = options.pageHeight ?? A4.height
    this.page = this.addPage()
    this.y = this.margin
  }

  get contentWidth(): number {
    return this.pageWidth - this.margin * 2
  }

  get left(): number {
    return this.margin
  }

  get right(): number {
    return this.pageWidth - this.margin
  }

  get pages(): number {
    return this.pageCount
  }

  /** Register a header drawn on every page after the first. */
  setContinuationHeader(draw: (writer: PdfWriter) => void): void {
    this.onNewPage = draw
  }

  private addPage(): PDFPage {
    this.pageCount += 1
    return this.doc.addPage([this.pageWidth, this.pageHeight])
  }

  /** pdf-lib y for a baseline `distanceFromTop` down the page. */
  private toPdfY(distanceFromTop: number): number {
    return this.pageHeight - distanceFromTop
  }

  /** Start a new page if `height` more points will not fit above the margin. */
  ensureSpace(height: number): void {
    if (this.y + height <= this.pageHeight - this.margin) {
      return
    }
    this.page = this.addPage()
    this.y = this.margin
    this.onNewPage?.(this)
  }

  moveDown(points: number): void {
    this.y += points
  }

  /** Draw one line at the cursor without wrapping, then advance. */
  line(text: string, x: number, options: TextOptions = {}): void {
    const size = options.size ?? 10
    const font = options.bold ? this.fonts.bold : this.fonts.regular
    const clean = sanitizePdfText(text)
    const lineHeight = options.lineHeight ?? size * 1.4
    this.ensureSpace(lineHeight)

    let drawX = x
    if (options.align === "right") {
      const rightEdge = options.width !== undefined ? x + options.width : x
      drawX = rightEdge - font.widthOfTextAtSize(clean, size)
    }

    this.page.drawText(clean, {
      x: drawX,
      y: this.toPdfY(this.y + size),
      size,
      font,
      color: options.color ?? COLORS.ink,
    })
    this.y += lineHeight
  }

  /** Draw wrapped text at the cursor, then advance past it. */
  paragraph(text: string, x: number, options: TextOptions = {}): void {
    const size = options.size ?? 10
    const font = options.bold ? this.fonts.bold : this.fonts.regular
    const width = options.width ?? this.right - x
    for (const line of wrapText(text, font, size, width)) {
      this.line(line, x, { ...options, width, align: options.align ?? "left" })
    }
  }

  /**
   * Draw a label on the left and a value on the right, on one line.
   * The value is right-aligned to `right`.
   */
  keyValue(
    label: string,
    value: string,
    x: number,
    right: number,
    options: { size?: number; bold?: boolean; color?: PdfColor } = {}
  ): void {
    const size = options.size ?? 10
    const lineHeight = size * 1.5
    this.ensureSpace(lineHeight)
    const startY = this.y
    this.line(label, x, { size, color: options.color ?? COLORS.muted, lineHeight })
    this.y = startY
    this.line(value, x, {
      size,
      bold: options.bold,
      width: right - x,
      align: "right",
      lineHeight,
    })
  }

  /** A horizontal rule across the content width. */
  rule(color: PdfColor = COLORS.rule, thickness = 0.75): void {
    this.ensureSpace(thickness + 4)
    this.page.drawLine({
      start: { x: this.left, y: this.toPdfY(this.y) },
      end: { x: this.right, y: this.toPdfY(this.y) },
      thickness,
      color,
    })
    this.y += thickness + 4
  }

  /**
   * A table with a dark header band, zebra rows, wrapped cells and page breaks.
   *
   * Row height is the tallest wrapped cell in the row. The header is redrawn
   * after a page break so a row is never orphaned from its column labels.
   */
  table(options: TableOptions): void {
    const size = options.fontSize ?? 9
    const padding = options.rowPadding ?? 5
    const lineHeight = size * 1.35
    const columns = options.columns
    const zebra = options.zebra ?? true

    const drawHeader = () => {
      const height = lineHeight + padding * 2
      this.ensureSpace(height)
      this.page.drawRectangle({
        x: this.left,
        y: this.toPdfY(this.y + height),
        width: this.contentWidth,
        height,
        color: COLORS.headerBand,
      })
      let x = this.left
      for (const column of columns) {
        const label = sanitizePdfText(column.label)
        const textWidth = this.fonts.bold.widthOfTextAtSize(label, size)
        const drawX =
          column.align === "right"
            ? x + column.width - padding - textWidth
            : x + padding
        this.page.drawText(label, {
          x: drawX,
          y: this.toPdfY(this.y + padding + size),
          size,
          font: this.fonts.bold,
          color: COLORS.white,
        })
        x += column.width
      }
      this.y += height
    }

    drawHeader()

    options.rows.forEach((row, rowIndex) => {
      const wrapped = columns.map((column, index) =>
        wrapText(row[index] ?? "", this.fonts.regular, size, column.width - padding * 2)
      )
      const lines = Math.max(1, ...wrapped.map((cell) => cell.length))
      const height = lines * lineHeight + padding * 2

      if (this.y + height > this.pageHeight - this.margin) {
        this.page = this.addPage()
        this.y = this.margin
        this.onNewPage?.(this)
        drawHeader()
      }

      if (zebra && rowIndex % 2 === 1) {
        this.page.drawRectangle({
          x: this.left,
          y: this.toPdfY(this.y + height),
          width: this.contentWidth,
          height,
          color: COLORS.zebra,
        })
      }

      let x = this.left
      columns.forEach((column, index) => {
        wrapped[index].forEach((text, lineIndex) => {
          const textWidth = this.fonts.regular.widthOfTextAtSize(text, size)
          const drawX =
            column.align === "right"
              ? x + column.width - padding - textWidth
              : x + padding
          this.page.drawText(text, {
            x: drawX,
            y: this.toPdfY(this.y + padding + size + lineIndex * lineHeight),
            size,
            font: this.fonts.regular,
            color: COLORS.ink,
          })
        })
        x += column.width
      })

      this.y += height
    })

    this.rule()
  }

  /** Small grey text at the bottom margin of every page, e.g. page numbers. */
  finishWithFooter(text: (pageIndex: number, pageCount: number) => string): void {
    const pages = this.doc.getPages()
    pages.forEach((page, index) => {
      const label = sanitizePdfText(text(index + 1, pages.length))
      page.drawText(label, {
        x: this.left,
        y: this.margin * 0.5,
        size: 8,
        font: this.fonts.regular,
        color: COLORS.muted,
      })
    })
  }
}
