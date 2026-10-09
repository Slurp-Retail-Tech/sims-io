import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

import { PDFDocument } from "pdf-lib"

import { buildDocumentContent } from "../renewal/document-content.ts"
import type { DocumentSource } from "../renewal/document-content.ts"
import { formatDocumentDate, renderRenewalDocument } from "./renewal-documents.ts"
import type { RenewalDocument } from "./renewal-documents.ts"
import { sanitizePdfText } from "./layout.ts"

function source(overrides: Partial<DocumentSource> = {}): DocumentSource {
  return {
    kind: "proforma",
    invoiceNumber: "PI-2026/09-014",
    issueDate: "2026-09-17",
    dueDate: "2026-10-02",
    paidAt: null,
    paidVia: null,
    paymentReference: null,
    companyName: "Kedai Kopi Sdn Bhd",
    franchiseId: "501",
    paymentEmail: null,
    isGrouped: false,
    outletCount: 1,
    term: "annually",
    periodEnd: "2027-10-02",
    currencyCode: "MYR",
    lines: [
      {
        outletId: "3",
        outletName: "Outlet Three",
        licensePlan: "essential",
        previousValidUntil: "2026-10-02",
        newValidUntil: null,
        catalogMinor: 120000,
        adjustmentMinor: 0,
        amountMinor: 120000,
      },
    ],
    totals: { subtotalMinor: 120000, taxRatePercent: 0, taxMinor: 0, totalMinor: 120000 },
    ...overrides,
  }
}

function document(sourceOverrides: Partial<DocumentSource> = {}, overrides: Partial<RenewalDocument> = {}): RenewalDocument {
  const built = source(sourceOverrides)
  return {
    kind: built.kind,
    invoiceNumber: built.invoiceNumber,
    content: buildDocumentContent(built),
    seller: { name: "Slurp", lines: ["Renewals", "renewals@example.test"] },
    payLink: built.kind === "proforma" ? "https://sims.example.test/renew/abc" : null,
    ...overrides,
  }
}

test("renders a one-page proforma with the number in the title", async () => {
  const bytes = await renderRenewalDocument(document())
  assert.equal(Buffer.from(bytes.slice(0, 5)).toString(), "%PDF-")
  const parsed = await PDFDocument.load(bytes)
  assert.equal(parsed.getPageCount(), 1)
  assert.equal(parsed.getTitle(), "PROFORMA INVOICE PI-2026/09-014")
})

test("the Slurp logo is drawn when given, and a bad one never costs the document", async () => {
  const logo = new Uint8Array(readFileSync(new URL("../../../public/slurp-logo-basic-03.png", import.meta.url)))
  const withLogo = await renderRenewalDocument(document({}, { logo }))
  const without = await renderRenewalDocument(document())
  assert.ok(withLogo.byteLength > without.byteLength, "the embedded logo adds to the file")
  const broken = await renderRenewalDocument(document({}, { logo: new Uint8Array([1, 2, 3]) }))
  assert.equal(Buffer.from(broken.slice(0, 5)).toString(), "%PDF-")
})

test("a long grouped invoice breaks across pages rather than overflowing", async () => {
  const lines = Array.from({ length: 60 }, (_, index) => ({
    outletId: String(index + 1),
    outletName: `Outlet ${index + 1} with a deliberately long trading name to force wrapping`,
    licensePlan: "premium",
    previousValidUntil: "2026-10-02",
    newValidUntil: null,
    catalogMinor: 70000,
    adjustmentMinor: -5000,
    amountMinor: 65000,
  }))
  const bytes = await renderRenewalDocument(
    document({
      isGrouped: true,
      outletCount: 60,
      term: "bi_annually",
      lines,
      totals: { subtotalMinor: 65000 * 60, taxRatePercent: 0, taxMinor: 0, totalMinor: 65000 * 60 },
    })
  )
  const parsed = await PDFDocument.load(bytes)
  assert.ok(parsed.getPageCount() >= 2, `expected multiple pages, got ${parsed.getPageCount()}`)
})

test("a non-Latin outlet name does not abort the render", async () => {
  const bytes = await renderRenewalDocument(
    document({ lines: [{ ...source().lines[0], outletName: "咖啡店 ☕ Kopitiam" }] })
  )
  assert.equal(Buffer.from(bytes.slice(0, 5)).toString(), "%PDF-")
  assert.equal(sanitizePdfText("咖啡店 ☕ Kopitiam"), "??? ? Kopitiam")
})

test("typographic characters the standard font can encode are kept", async () => {
  assert.equal(sanitizePdfText("8 OCT 2026 – 8 OCT 2027 — “Kopi” ‘Ais’ … • € ™"), "8 OCT 2026 – 8 OCT 2027 — “Kopi” ‘Ais’ … • € ™")
  // And they really render: drawText throws on a character the font lacks.
  const bytes = await renderRenewalDocument(
    document({ lines: [{ ...source().lines[0], outletName: "Kedai “Kopi” – Bangsar … ™" }] })
  )
  assert.equal(Buffer.from(bytes.slice(0, 5)).toString(), "%PDF-")
})

test("receipt and tax invoice render with the titles the page uses", async () => {
  const receipt = await PDFDocument.load(
    await renderRenewalDocument(
      document({
        kind: "receipt",
        taxInvoiceNumber: "INV-2026/10-003",
        paidAt: "2026-10-01 06:12:00.000",
        paidVia: "commercepay",
        paymentReference: "2005671137F81FD81D89D8",
      })
    )
  )
  assert.equal(receipt.getTitle(), "OFFICIAL RECEIPT PI-2026/09-014")

  const tax = await PDFDocument.load(
    await renderRenewalDocument(
      document({ kind: "tax_invoice", invoiceNumber: "INV-2026/10-003", proformaNumber: "PI-2026/09-014" })
    )
  )
  assert.equal(tax.getTitle(), "TAX INVOICE INV-2026/10-003")
})

test("dates are read literally, never through the local timezone", () => {
  assert.equal(formatDocumentDate("2026-10-15"), "15 Oct 2026")
  assert.equal(formatDocumentDate("2026-10-15 00:30:00.000"), "15 Oct 2026")
  assert.equal(formatDocumentDate(null), "-")
  assert.equal(formatDocumentDate("not a date"), "not a date")
})
