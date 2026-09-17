import assert from "node:assert/strict"
import test from "node:test"

import type { DueSubscription } from "./invoice-build.ts"
import {
  CYCLE_EVALUATED_REASONS,
  cycleHorizonDays,
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
const dueDates = new Set(["2026-10-02", "2026-09-22", "2026-09-18"])

test("an offset date is due, everything else inside the window is upcoming", () => {
  const { due, upcoming } = partitionForCycle(
    [
      subscription("a", "2026-10-02"), // T-15
      subscription("b", "2026-09-30"), // 13 days out
      subscription("c", "2026-09-18"), // T-1
      subscription("d", "2026-10-15"), // 28 days out
    ],
    dueDates,
    today,
    30
  )

  assert.deepEqual(due.map((entry) => entry.outletId), ["a", "c"])
  assert.deepEqual(upcoming.map((entry) => entry.outletId), ["b", "d"])
})

test("a subscription beyond the window is dropped, not treated as upcoming", () => {
  const { upcoming } = partitionForCycle(
    [subscription("far", "2026-10-30")], // 43 days out
    dueDates,
    today,
    30
  )
  assert.deepEqual(upcoming, [])
})

test("expiring today counts as upcoming; already expired does not", () => {
  const { upcoming } = partitionForCycle(
    [subscription("today", "2026-09-17"), subscription("past", "2026-09-16")],
    dueDates,
    today,
    30
  )
  assert.deepEqual(upcoming.map((entry) => entry.outletId), ["today"])
})

test("an offset date stays due even when the window is shorter than the offset", () => {
  // Window 10 days, but T-15 is still a reminder date. The invoice must still
  // be raised; the window only governs the early warning.
  const { due, upcoming } = partitionForCycle(
    [subscription("a", "2026-10-02")],
    dueDates,
    today,
    10
  )
  assert.equal(due.length, 1)
  assert.equal(upcoming.length, 0)
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
