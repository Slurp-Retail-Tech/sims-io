import assert from "node:assert/strict"
import test from "node:test"

import {
  planRowPhases,
  remainingPhases,
  rowOutcome,
  type PlusPhaseRecord,
} from "./plus-import-plan.ts"

const base = {
  currentMerchantId: "M-1",
  newMerchantId: "M-2",
  oldCategoryText: "Cafe",
  newCategoryText: "Restaurant",
  resolvedCategoryId: 22,
}

test("a row needing both writes plans both, with pre-images", () => {
  assert.deepEqual(planRowPhases(base), [
    { phase: "merchant_id", previous: "M-1", next: "M-2" },
    { phase: "category_business", previous: "Cafe", next: 22 },
  ])
})

test("a phase already at its target value is not planned", () => {
  // What makes re-uploading the same spreadsheet cheap rather than a rewrite.
  assert.deepEqual(planRowPhases({ ...base, currentMerchantId: "M-2" }), [
    { phase: "category_business", previous: "Cafe", next: 22 },
  ])
  assert.deepEqual(
    planRowPhases({ ...base, oldCategoryText: "Restaurant" }),
    [{ phase: "merchant_id", previous: "M-1", next: "M-2" }]
  )
})

test("planning ignores surrounding whitespace", () => {
  assert.deepEqual(
    planRowPhases({
      ...base,
      currentMerchantId: "  M-2  ",
      oldCategoryText: " Restaurant ",
    }),
    []
  )
})

test("a category with no resolved id is never planned", () => {
  // Writing an unresolved category would push a null into POS.
  assert.deepEqual(planRowPhases({ ...base, resolvedCategoryId: null }), [
    { phase: "merchant_id", previous: "M-1", next: "M-2" },
  ])
})

test("a replayed row skips the phase that already landed", () => {
  // The regression test for the two-phase bug: after a reclaimed lease, only
  // the phase that failed may be re-sent to POS.
  const plan = planRowPhases(base)
  const prior: Record<string, PlusPhaseRecord> = {
    merchant_id: { state: "applied", previous: "M-1", next: "M-2" },
    category_business: {
      state: "failed",
      previous: "Cafe",
      next: 22,
      error: "POS 500",
    },
  }

  assert.deepEqual(remainingPhases(plan, prior), [
    { phase: "category_business", previous: "Cafe", next: 22 },
  ])
})

test("with no prior attempt every planned phase remains", () => {
  const plan = planRowPhases(base)
  assert.deepEqual(remainingPhases(plan, null), plan)
  assert.deepEqual(remainingPhases(plan, {}), plan)
})

test("a fully applied row leaves nothing to re-send", () => {
  const plan = planRowPhases(base)
  assert.deepEqual(
    remainingPhases(plan, {
      merchant_id: { state: "applied", previous: "M-1", next: "M-2" },
      category_business: { state: "applied", previous: "Cafe", next: 22 },
    }),
    []
  )
})

test("outcome distinguishes partial from failed", () => {
  const applied: PlusPhaseRecord = { state: "applied", previous: "a", next: "b" }
  const failed: PlusPhaseRecord = { state: "failed", previous: "a", next: "b" }
  const skipped: PlusPhaseRecord = { state: "skipped", previous: "a", next: "b" }

  assert.equal(rowOutcome({ merchant_id: applied, category_business: applied }), "updated")
  // The state the old whole-row boolean could not express.
  assert.equal(rowOutcome({ merchant_id: applied, category_business: failed }), "partial")
  assert.equal(rowOutcome({ merchant_id: failed, category_business: failed }), "failed")
  assert.equal(rowOutcome({ merchant_id: skipped }), "skipped")
  assert.equal(rowOutcome({}), "skipped")
})
