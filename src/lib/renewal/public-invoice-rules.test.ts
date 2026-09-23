import assert from "node:assert/strict"
import test from "node:test"

import { graceEndsOn, isRenewalTokenShape, lapsedIfDueBefore, payabilityOf } from "./public-invoice-rules.ts"

test("only a 43-character base64url string is a token", () => {
  assert.equal(isRenewalTokenShape("LudT_PJgIvxuOT1z-hx6d5pX9XUkSJlwh2LgtRN0SK8"), true)
  assert.equal(isRenewalTokenShape("LudT_PJgIvxuOT1z-hx6d5pX9XUkSJlwh2LgtRN0SK"), false)
  assert.equal(isRenewalTokenShape("LudT_PJgIvxuOT1z-hx6d5pX9XUkSJlwh2LgtRN0SK8="), false)
  assert.equal(isRenewalTokenShape("../../etc/passwd/../../../../../../aaaaaaaaaa"), false)
  assert.equal(isRenewalTokenShape(42), false)
  assert.equal(isRenewalTokenShape(null), false)
})

test("an open invoice inside the grace window is payable", () => {
  assert.equal(
    payabilityOf({ status: "issued", dueDate: "2026-10-02" }, 30, "2026-10-20"),
    "payable"
  )
  // The last day of grace is still payable.
  assert.equal(
    payabilityOf({ status: "sent", dueDate: "2026-10-02" }, 30, "2026-11-01"),
    "payable"
  )
})

test("the day after grace ends, the invoice has lapsed", () => {
  assert.equal(
    payabilityOf({ status: "issued", dueDate: "2026-10-02" }, 30, "2026-11-02"),
    "lapsed"
  )
  assert.equal(graceEndsOn("2026-10-02", 30), "2026-11-01")
})

test("paid, cancelled and superseded are never payable", () => {
  assert.equal(payabilityOf({ status: "paid", dueDate: "2026-10-02" }, 30, "2026-09-01"), "paid")
  assert.equal(payabilityOf({ status: "cancelled", dueDate: "2026-10-02" }, 30, "2026-09-01"), "closed")
  assert.equal(payabilityOf({ status: "superseded", dueDate: "2026-10-02" }, 30, "2026-09-01"), "closed")
  assert.equal(payabilityOf({ status: "lapsed", dueDate: "2026-10-02" }, 30, "2026-09-01"), "lapsed")
})

test("a payment already pending at the gateway is still payable from the link", () => {
  // The merchant may come back to finish paying; the session is resumed.
  assert.equal(
    payabilityOf({ status: "payment_pending", dueDate: "2026-10-02" }, 30, "2026-10-05"),
    "payable"
  )
})

test("no due date means no grace cut-off", () => {
  assert.equal(payabilityOf({ status: "issued", dueDate: null }, 30, "2099-01-01"), "payable")
  assert.equal(graceEndsOn(null, 30), null)
})

test("the lapse sweep's cutoff agrees with what the merchant's page shows", () => {
  const today = "2026-09-23"
  for (const grace of [0, 1, 30]) {
    const cutoff = lapsedIfDueBefore(today, grace)
    for (let offset = -40; offset <= 5; offset += 1) {
      const dueDate = new Date(Date.UTC(2026, 8, 23 + offset)).toISOString().slice(0, 10)
      const sweepLapses = dueDate < cutoff
      const pageSaysLapsed = payabilityOf({ status: "issued", dueDate }, grace, today) === "lapsed"
      assert.equal(sweepLapses, pageSaysLapsed, `grace ${grace}, due ${dueDate}`)
    }
  }
})
