import assert from "node:assert/strict"
import test from "node:test"

import type { DueSubscription } from "./invoice-build.ts"
import {
  CYCLE_EVALUATED_REASONS,
  cycleHorizonDays,
  invoiceWindowDays,
  partitionForCycle,
  scopeKey,
} from "./readiness.ts"

function subscription(outletId: string, validUntilDate: string): DueSubscription {
  return {
    outletSubscriptionId: outletId,
    franchiseId: "501",
    outletId,
    centralId: null,
    outletName: `Outlet ${outletId}`,
    companyName: "Kedai Kopi Sdn Bhd",
    validUntilDate,
    billedBy: "slurp",
    billingHold: false,
  }
}

const today = "2026-09-17"
/** The furthest of the default offsets [15, 5, 1]. */
const invoiceWindow = 15

test("everything inside the invoicing window is due; the rest of the readiness window is upcoming", () => {
  const { due, upcoming } = partitionForCycle(
    [
      subscription("a", "2026-10-02"), // T-15, the far edge of the window
      subscription("b", "2026-09-30"), // 13 days out, between two offsets
      subscription("c", "2026-09-18"), // T-1
      subscription("d", "2026-10-15"), // 28 days out, readiness only
    ],
    invoiceWindow,
    today,
    30
  )

  assert.deepEqual(due.map((entry) => entry.outletId), ["a", "b", "c"])
  assert.deepEqual(upcoming.map((entry) => entry.outletId), ["d"])
})

test("an expiry that moved past every offset is still due", () => {
  // The whole point of the window. This outlet sits 13, 8 and 3 days out on
  // successive nights and never lands on 15, 5 or 1; under exact-date
  // matching it would lapse without an invoice ever being raised.
  for (const [date, label] of [
    ["2026-09-30", "13 days"],
    ["2026-09-25", "8 days"],
    ["2026-09-20", "3 days"],
  ]) {
    const { due } = partitionForCycle([subscription("moved", date)], invoiceWindow, today, 30)
    assert.equal(due.length, 1, `expected due at ${label}`)
  }
})

test("a subscription beyond the readiness window is dropped entirely", () => {
  const { due, upcoming } = partitionForCycle(
    [subscription("far", "2026-10-30")], // 43 days out
    invoiceWindow,
    today,
    30
  )
  assert.deepEqual(due, [])
  assert.deepEqual(upcoming, [])
})

test("expiring today is still due; already expired is dropped from both passes", () => {
  // An expiry that lapsed without an invoice is a question for a person, not
  // something to bill for retroactively on the next run.
  const { due, upcoming } = partitionForCycle(
    [subscription("today", "2026-09-17"), subscription("past", "2026-09-16")],
    invoiceWindow,
    today,
    30
  )
  assert.deepEqual(due.map((entry) => entry.outletId), ["today"])
  assert.deepEqual(upcoming, [])
})

test("a readiness window shorter than the offset does not shrink the due cohort", () => {
  // Window 10 days, but T-15 is still a reminder date. The invoice must still
  // be raised; the window only governs the early warning.
  const { due, upcoming } = partitionForCycle(
    [subscription("a", "2026-10-02")],
    invoiceWindow,
    today,
    10
  )
  assert.equal(due.length, 1)
  assert.equal(upcoming.length, 0)
})

test("the invoicing window is the furthest configured offset", () => {
  assert.equal(invoiceWindowDays([15, 5, 1]), 15)
  assert.equal(invoiceWindowDays([30, 7]), 30)
  // No offsets, or only nonsensical ones, collapses to the expiry date itself
  // rather than inverting the window.
  assert.equal(invoiceWindowDays([]), 0)
  assert.equal(invoiceWindowDays([-5]), 0)
})

test("the read horizon is the larger of the window and the furthest offset", () => {
  assert.equal(cycleHorizonDays([15, 5, 1], 30), 30)
  assert.equal(cycleHorizonDays([15, 5, 1], 10), 15)
  assert.equal(cycleHorizonDays([], 30), 30)
  // A negative setting cannot turn the range inside out.
  assert.equal(cycleHorizonDays([15, 5, 1], -4), 15)
})

test("scope keys use * for a franchise-level entry", () => {
  assert.equal(scopeKey("501", "3"), "501|3")
  assert.equal(scopeKey("501", null), "501|*")
})

test("the cycle only auto-resolves the reasons it evaluates", () => {
  // Anything raised by payment, dispatch or POS steps stays open until that
  // process, or a person, closes it.
  assert.ok(CYCLE_EVALUATED_REASONS.includes("no_plan_assigned"))
  assert.ok(CYCLE_EVALUATED_REASONS.includes("no_renewal_pic"))
  assert.ok(!(CYCLE_EVALUATED_REASONS as readonly string[]).includes("dispatch_failed"))
  assert.ok(!(CYCLE_EVALUATED_REASONS as readonly string[]).includes("pos_push_failed"))
})
