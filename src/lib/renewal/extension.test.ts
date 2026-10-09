import assert from "node:assert/strict"
import test from "node:test"

import {
  extendValidUntil,
  formatPosValidUntil,
  planExtensions,
} from "./extension.ts"
import type { ExtensionInput } from "./extension.ts"

function input(overrides: Partial<ExtensionInput> = {}): ExtensionInput {
  return {
    itemId: "10",
    outletId: "501",
    outletSubscriptionId: "77",
    subscriptionValidUntil: "2026-10-02 16:00:00.000",
    linePreviousValidUntil: "2026-10-02 16:00:00.000",
    termMonths: 12,
    ...overrides,
  }
}

test("the new expiry is the previous expiry plus the term, keeping the time of day", () => {
  assert.equal(extendValidUntil("2026-10-02 16:00:00.000", 12), "2027-10-02 16:00:00.000")
  assert.equal(extendValidUntil("2026-10-02 16:00:00.000", 6), "2027-04-02 16:00:00.000")
})

test("month ends clamp rather than roll over", () => {
  assert.equal(extendValidUntil("2026-08-31 00:00:00.000", 6), "2027-02-28 00:00:00.000")
  assert.equal(extendValidUntil("2028-02-29 12:00:00.000", 12), "2029-02-28 12:00:00.000")
})

test("a date without a time is accepted and given midnight", () => {
  assert.equal(extendValidUntil("2026-10-02", 12), "2027-10-02 00:00:00.000")
})

test("a non-date or a non-positive term is refused", () => {
  assert.throws(() => extendValidUntil("soon", 12))
  assert.throws(() => extendValidUntil("2026-10-02 00:00:00.000", 0))
})

test("the plan extends from the subscription's current date, not the payment date", () => {
  const plan = planExtensions([input()])
  assert.ok(plan.ok)
  assert.equal(plan.lines[0].previousValidUntil, "2026-10-02 16:00:00.000")
  assert.equal(plan.lines[0].newValidUntil, "2027-10-02 16:00:00.000")
  assert.equal(plan.lines[0].drifted, false)
})

test("a subscription that moved since the line was generated is flagged, and its date wins", () => {
  const plan = planExtensions([
    input({
      subscriptionValidUntil: "2027-10-02 16:00:00.000",
      linePreviousValidUntil: "2026-10-02 16:00:00.000",
    }),
  ])
  assert.ok(plan.ok)
  assert.equal(plan.lines[0].drifted, true)
  assert.equal(plan.lines[0].newValidUntil, "2028-10-02 16:00:00.000")
})

test("the line's date is the fallback when the subscription has none", () => {
  const plan = planExtensions([input({ subscriptionValidUntil: null })])
  assert.ok(plan.ok)
  assert.equal(plan.lines[0].previousValidUntil, "2026-10-02 16:00:00.000")
  assert.equal(plan.lines[0].drifted, false)
})

test("one outlet with nothing to extend from refuses the whole invoice", () => {
  const plan = planExtensions([
    input(),
    input({ itemId: "11", outletId: "502", subscriptionValidUntil: null, linePreviousValidUntil: null }),
  ])
  assert.deepEqual(plan, { ok: false, reason: "missing_valid_until", outletId: "502" })
})

test("an empty invoice or a bad term is refused", () => {
  assert.deepEqual(planExtensions([]), { ok: false, reason: "no_lines", outletId: null })
  assert.deepEqual(planExtensions([input({ termMonths: 0 })]), {
    ok: false,
    reason: "invalid_term",
    outletId: "501",
  })
})

test("the POS timestamp is Kuala Lumpur time with a colon-less +0800", () => {
  // 04:12 UTC is 12:12 in Kuala Lumpur.
  assert.equal(formatPosValidUntil("2026-09-15 04:12:00.000"), "2026-09-15T12:12:00+0800")
  // Crosses midnight: 16:00 UTC on the 2nd is 00:00 on the 3rd.
  assert.equal(formatPosValidUntil("2026-10-02 16:00:00.000"), "2026-10-03T00:00:00+0800")
  assert.equal(formatPosValidUntil("2026-10-02"), "2026-10-02T08:00:00+0800")
})
