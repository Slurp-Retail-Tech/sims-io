import assert from "node:assert/strict"
import test from "node:test"

import { buildDocumentContent } from "./document-content.ts"
import {
  buildSampleDocumentSource,
  isSampleDocumentKind,
  SAMPLE_PROFORMA_NUMBER,
  SAMPLE_TAX_INVOICE_NUMBER,
} from "./sample-document.ts"

test("the sample proforma is dated today and bills an expiry 15 days out", () => {
  const source = buildSampleDocumentSource("proforma", { taxRatePercent: 0, today: "2026-12-20" })
  assert.equal(source.invoiceNumber, SAMPLE_PROFORMA_NUMBER)
  assert.equal(source.issueDate, "2026-12-20")
  assert.equal(source.dueDate, "2027-01-04")
  assert.equal(source.periodEnd, "2028-01-04")
  assert.equal(source.paidAt, null)
  assert.ok(source.lines.every((line) => line.newValidUntil === null))
})

test("paid samples carry their payment and each other's numbers", () => {
  const taxInvoice = buildSampleDocumentSource("tax_invoice", { taxRatePercent: 0, today: "2026-10-09" })
  assert.equal(taxInvoice.invoiceNumber, SAMPLE_TAX_INVOICE_NUMBER)
  assert.equal(taxInvoice.proformaNumber, SAMPLE_PROFORMA_NUMBER)
  assert.equal(taxInvoice.paidAt, "2026-10-09")

  const receipt = buildSampleDocumentSource("receipt", { taxRatePercent: 0, today: "2026-10-09" })
  assert.equal(receipt.invoiceNumber, SAMPLE_PROFORMA_NUMBER)
  assert.equal(receipt.taxInvoiceNumber, SAMPLE_TAX_INVOICE_NUMBER)
  assert.ok(receipt.lines.every((line) => line.newValidUntil === "2027-10-24"))
})

test("tax appears only when a rate is configured, and the totals add up", () => {
  const untaxed = buildDocumentContent(buildSampleDocumentSource("proforma", { taxRatePercent: 0, today: "2026-10-09" }))
  assert.equal(untaxed.taxVisible, false)
  assert.equal(untaxed.total, "RM 2,400.00")

  const source = buildSampleDocumentSource("proforma", { taxRatePercent: 8, today: "2026-10-09" })
  assert.equal(source.totals.taxMinor, 19_200)
  assert.equal(source.totals.totalMinor, 259_200)
  assert.equal(buildDocumentContent(source).taxVisible, true)
})

test("every name on the sample says it is a sample", () => {
  const content = buildDocumentContent(buildSampleDocumentSource("receipt", { taxRatePercent: 0, today: "2026-10-09" }))
  assert.match(content.billTo.name, /Sample/)
  assert.ok(content.lines.every((line) => /SAMPLE/.test(line.outlet)))
})

test("only the three document kinds are accepted", () => {
  assert.equal(isSampleDocumentKind("receipt"), true)
  assert.equal(isSampleDocumentKind("invoice"), false)
  assert.equal(isSampleDocumentKind(null), false)
})
