import assert from "node:assert/strict"
import test from "node:test"

import { PDFDocument } from "pdf-lib"

import { formatDocumentDate, renderRenewalDocument } from "./renewal-documents.ts"
import type { RenewalDocument } from "./renewal-documents.ts"
import { sanitizePdfText } from "./layout.ts"

function proforma(overrides: Partial<RenewalDocument> = {}): RenewalDocument {
  return {
    kind: "proforma",
    invoiceNumber: "PI-2026/09-014",
    issueDate: "2026-09-17",
    dueDate: "2026-10-02",
    currencyCode: "MYR",
    billTo: { companyName: "Kedai Kopi Sdn Bhd", franchiseId: "501" },
    seller: { name: "Slurp", lines: ["Renewals", "renewals@example.test"] },
    lines: [
      {
        outletName: "Outlet Three",
        outletId: "3",
        licensePlan: "essential",
        termLabel: "1 year",
        periodStart: "2026-10-02",
        periodEnd: "2027-10-02",
        catalogMinor: 120000,
        adjustmentMinor: 0,
        amountMinor: 120000,
      },
    ],
    totals: {
      subtotalMinor: 120000,
      adjustmentMinor: 0,
      taxRatePercent: 0,
      taxMinor: 0,
      totalMinor: 120000,
    },
    payLink: "https://sims.example.test/renew/abc",
    ...overrides,
  }
}

test("renders a one-page proforma with the number in the title", async () => {
  const bytes = await renderRenewalDocument(proforma())
  assert.equal(Buffer.from(bytes.slice(0, 5)).toString(), "%PDF-")

  const parsed = await PDFDocument.load(bytes)
  assert.equal(parsed.getPageCount(), 1)
  assert.equal(parsed.getTitle(), "PROFORMA INVOICE PI-2026/09-014")
})

test("a long grouped invoice breaks across pages rather than overflowing", async () => {
  const lines = Array.from({ length: 60 }, (_, index) => ({
    outletName: `Outlet ${index + 1} with a deliberately long trading name to force wrapping`,
    outletId: String(index + 1),
    licensePlan: "premium",
    termLabel: "6 months",
    periodStart: "2026-10-02",
    periodEnd: "2027-04-02",
    catalogMinor: 70000,
    adjustmentMinor: -5000,
    amountMinor: 65000,
  }))
  const bytes = await renderRenewalDocument(
    proforma({
      lines,
      totals: {
        subtotalMinor: 65000 * 60,
        adjustmentMinor: -5000 * 60,
        taxRatePercent: 0,
        taxMinor: 0,
        totalMinor: 65000 * 60,
      },
    })
  )
  const parsed = await PDFDocument.load(bytes)
  assert.ok(parsed.getPageCount() >= 2, `expected multiple pages, got ${parsed.getPageCount()}`)
})

test("a non-Latin outlet name does not abort the render", async () => {
  const bytes = await renderRenewalDocument(
    proforma({
      lines: [{ ...proforma().lines[0], outletName: "咖啡店 ☕ Kopitiam" }],
    })
  )
  assert.equal(Buffer.from(bytes.slice(0, 5)).toString(), "%PDF-")
  assert.equal(sanitizePdfText("咖啡店 ☕ Kopitiam"), "??? ? Kopitiam")
})

test("receipt and tax invoice render with their own titles", async () => {
  const receipt = await PDFDocument.load(
    await renderRenewalDocument(
      proforma({
        kind: "receipt",
        invoiceNumber: "INV-2026/10-003",
        referenceNumber: "PI-2026/09-014",
        paidAt: "2026-10-01 06:12:00.000",
        paymentReference: "2005671137F81FD81D89D8",
        payLink: null,
      })
    )
  )
  assert.equal(receipt.getTitle(), "PAYMENT RECEIPT INV-2026/10-003")

  const tax = await PDFDocument.load(
    await renderRenewalDocument(proforma({ kind: "tax_invoice", payLink: null }))
  )
  assert.equal(tax.getTitle(), "TAX INVOICE PI-2026/09-014")
})

test("dates are read literally, never through the local timezone", () => {
  assert.equal(formatDocumentDate("2026-10-15"), "15 Oct 2026")
  // A UTC DATETIME just after midnight must not become the previous day.
  assert.equal(formatDocumentDate("2026-10-15 00:30:00.000"), "15 Oct 2026")
  assert.equal(formatDocumentDate(null), "-")
  assert.equal(formatDocumentDate("not a date"), "not a date")
})
