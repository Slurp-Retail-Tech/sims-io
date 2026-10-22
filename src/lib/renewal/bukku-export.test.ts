import assert from "node:assert/strict"
import test from "node:test"

import {
  BUKKU_INVOICE_COLUMNS,
  buildBukkuRows,
  buildBukkuSheet,
  bukkuDate,
  describeLine,
  formatBatchReference,
  previousMonthRange,
} from "./bukku-export.ts"
import type { ExportableLine } from "./bukku-export.ts"

const line: ExportableLine = {
  invoiceNumber: "INV-2026/09-008",
  proformaNumber: "PI-2026/09-031",
  centralId: "C-10442-01",
  paidAt: "2026-09-12 04:10:00.000",
  companyName: "Kopitiam Sentral",
  bukkuContactCode: "C-K0042",
  legalName: "Kopitiam Sentral Sdn Bhd",
  franchiseId: "10442",
  outletName: "Jalan Tuanku",
  outletId: "22201",
  planName: "Premium Standard",
  billingPlan: "annually",
  previousValidUntil: "2026-09-28 00:00:00.000",
  effectiveMinor: 240000,
  taxRatePercent: 0,
  paidVia: "commercepay",
  capTransactionNumber: "2005671137F81FD81D89D8",
  paidReference: null,
}

const codes = { accountCode: "5000", taxCode: "SV8", classificationCode: "022" }

test("one row per line in the template's columns, dates as DD/MM/YYYY", () => {
  const [row] = buildBukkuRows([line], null, codes)
  assert.deepEqual(Object.keys(row), [...BUKKU_INVOICE_COLUMNS])
  assert.equal(row["Contact Code (1)"], "C-K0042")
  assert.equal(row["Legal Name (2)"], "Kopitiam Sentral Sdn Bhd")
  assert.equal(row["No. (3)"], "INV-2026/09-008")
  // Finance books the tax invoice; the proforma rides along for tracing.
  assert.equal(row["Reference No."], "PI-2026/09-031")
  assert.equal(row["Date (D) *"], "12/09/2026")
  assert.equal(row["Due Date (D) (5)"], "12/09/2026")
  assert.equal(row["Account (10) *"], "5000")
  assert.equal(row["Item Description *"], "Premium Standard · Jalan Tuanku · 2026-09-28 to 2027-09-28")
  assert.equal(row["Unit Price *"], "2400.00")
  assert.equal(row["Classification Code (16)"], "022")
  assert.equal(row["Field:outlet_id"], "22201")
  assert.equal(row.Title, "(RN) KOPITIAM SENTRAL SDN BHD @ 1 OUTLET - SLURP! LICENSE RENEWAL (YEARLY)")
  assert.equal(row.Description, "Paid by CommercePay, ref 2005671137F81FD81D89D8. Proforma PI-2026/09-031.")
})

test("the tax code is named only when the invoice carries tax", () => {
  assert.equal(buildBukkuRows([line], null, codes)[0]["Tax (15)"], "")
  assert.equal(buildBukkuRows([{ ...line, taxRatePercent: 8 }], null, codes)[0]["Tax (15)"], "SV8")
})

test("without a billing profile the customer is matched by company name, with no contact code", () => {
  const [row] = buildBukkuRows([{ ...line, bukkuContactCode: null, legalName: null }], null, codes)
  assert.equal(row["Contact Code (1)"], "")
  assert.equal(row["Legal Name (2)"], "Kopitiam Sentral")
})

test("a grouped invoice is one row per outlet, titled with the outlet count", () => {
  const rows = buildBukkuRows([line, { ...line, outletId: "22202", outletName: "Bangsar" }], null, codes)
  assert.equal(rows.length, 2)
  assert.ok(rows.every((row) => row.Title.includes("@ 2 OUTLETS")))
  assert.deepEqual(rows.map((row) => row["Field:outlet_id"]), ["22201", "22202"])
})

test("the sheet is framed as Bukku reads it: comments, the $ column line, data from column two", () => {
  const sheet = buildBukkuSheet(buildBukkuRows([line], null, codes), "BKX-2026-09-001")
  const header = sheet.findIndex((cells) => cells[0] === "$")
  assert.ok(sheet.slice(0, header).every((cells) => cells[0] === "#"))
  assert.deepEqual(sheet[header].slice(1), [...BUKKU_INVOICE_COLUMNS])
  assert.equal(sheet[header + 1][0], "")
  assert.equal(sheet[header + 1][1], "C-K0042")
  assert.equal(sheet[header + 1].length, BUKKU_INVOICE_COLUMNS.length + 1)
})

test("the merchant's PO number is the reference when they gave one, and a quotation is named as one", () => {
  const [row] = buildBukkuRows([{ ...line, poNumber: "PO-88812", issuedAs: "quotation", proformaNumber: "QT-2026/09-004" }], null, codes)
  assert.equal(row["Reference No."], "PO-88812")
  assert.match(row.Description, /Quotation QT-2026\/09-004\.$/)
})

test("bukkuDate reads the date literally", () => {
  assert.equal(bukkuDate("2026-01-05 23:59:59.000"), "05/01/2026")
  assert.equal(bukkuDate(null), "")
})

test("the description follows the configured format", () => {
  assert.equal(
    describeLine(null, line),
    "Premium Standard · Jalan Tuanku · 2026-09-28 to 2027-09-28"
  )
  assert.equal(describeLine("{outlet} ({oid}) {term}", line), "Jalan Tuanku (22201) 1 year")
  // Unknown placeholders stay visible rather than vanishing.
  assert.equal(describeLine("{plan} {nope}", line), "Premium Standard {nope}")
})

test("a six-month line spans six months from the previous expiry", () => {
  assert.match(describeLine(null, { ...line, billingPlan: "bi_annually" }), /2026-09-28 to 2027-03-28$/)
})

test("an offline payment is noted as a bank transfer, with its bank reference", () => {
  const [row] = buildBukkuRows(
    [{ ...line, paidVia: "manual", capTransactionNumber: null, paidReference: "MBB-7781203" }],
    null,
    codes
  )
  assert.equal(row.Description, "Paid by bank transfer, ref MBB-7781203. Proforma PI-2026/09-031.")
})

test("batch references carry the month and a running number", () => {
  assert.equal(formatBatchReference("2026-08-31", 1), "BKX-2026-08-001")
  assert.equal(formatBatchReference("2026-08-31", 12), "BKX-2026-08-012")
})

test("the default period is the previous calendar month, across a year boundary too", () => {
  assert.deepEqual(previousMonthRange("2026-09-17"), { from: "2026-08-01", to: "2026-08-31" })
  assert.deepEqual(previousMonthRange("2026-03-01"), { from: "2026-02-01", to: "2026-02-28" })
  assert.deepEqual(previousMonthRange("2026-01-15"), { from: "2025-12-01", to: "2025-12-31" })
})
