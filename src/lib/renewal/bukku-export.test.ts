import assert from "node:assert/strict"
import test from "node:test"

import {
  buildBukkuRows,
  describeLine,
  formatBatchReference,
  previousMonthRange,
} from "./bukku-export.ts"
import type { ExportableLine } from "./bukku-export.ts"

const line: ExportableLine = {
  invoiceNumber: "INV-2026/09-008",
  paidAt: "2026-09-12 04:10:00.000",
  companyName: "Kopitiam Sentral Sdn Bhd",
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
}

test("one row per line, amounts as decimals, date from paid_at", () => {
  const [row] = buildBukkuRows([line], null)
  assert.equal(row["Invoice Date"], "2026-09-12")
  assert.equal(row["Invoice No"], "INV-2026/09-008")
  assert.equal(row.Customer, "Kopitiam Sentral Sdn Bhd")
  assert.equal(row["Unit Price"], "2400.00")
  assert.equal(row["Tax Amount"], "0.00")
  assert.equal(row.Total, "2400.00")
  assert.equal(row["Payment Method"], "CommercePay")
  assert.equal(row["Payment Ref"], "2005671137F81FD81D89D8")
})

test("tax is exclusive and added on top when the rate is non-zero", () => {
  const [row] = buildBukkuRows([{ ...line, taxRatePercent: 8 }], null)
  assert.equal(row["Tax Amount"], "192.00")
  assert.equal(row.Total, "2592.00")
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

test("an offline payment is labelled as a bank transfer", () => {
  const [row] = buildBukkuRows([{ ...line, paidVia: "manual", capTransactionNumber: null }], null)
  assert.equal(row["Payment Method"], "Bank transfer")
  assert.equal(row["Payment Ref"], "")
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
