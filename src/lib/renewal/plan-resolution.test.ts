import assert from "node:assert/strict"
import test from "node:test"

import {
  TERM_MONTHS,
  availableTerms,
  requiresOverrideApproval,
  resolvePlanForOutlet,
  resolvePriceForLine,
} from "./plan-resolution.ts"
import type { AssignmentRecord, PlanRecord } from "./plan-resolution.ts"

const DEFAULT_THRESHOLD = 15

function plan(overrides: Partial<PlanRecord> = {}): PlanRecord {
  return {
    id: "1",
    planCode: "ESS-STD",
    planName: "Essential Standard",
    licensePlan: "essential",
    priceAnnuallyMinor: 120000,
    priceBiAnnuallyMinor: 70000,
    isActive: true,
    ...overrides,
  }
}

function assignment(overrides: Partial<AssignmentRecord> = {}): AssignmentRecord {
  return {
    id: "1",
    planId: "1",
    scope: "franchise",
    franchiseId: "501",
    outletId: null,
    overridePriceAnnuallyMinor: null,
    overridePriceBiAnnuallyMinor: null,
    overrideReason: null,
    defaultBillingPlan: "annually",
    approvalStatus: "not_required",
    isActive: true,
    ...overrides,
  }
}

test("a term maps to the months it adds", () => {
  assert.equal(TERM_MONTHS.annually, 12)
  assert.equal(TERM_MONTHS.bi_annually, 6)
})

// ---------------------------------------------------------------------------
// Plan resolution
// ---------------------------------------------------------------------------

test("an outlet with no assignment at either scope resolves to no plan", () => {
  assert.deepEqual(resolvePlanForOutlet([], "3"), { status: "no_plan_assigned" })
})

test("a franchise-scope assignment covers every outlet in the franchise", () => {
  const franchiseWide = assignment({ id: "10" })
  const resolution = resolvePlanForOutlet([franchiseWide], "9")

  assert.equal(resolution.status, "resolved")
  assert.equal(
    resolution.status === "resolved" ? resolution.source : null,
    "franchise"
  )
})

test("an outlet imported later inherits the franchise plan with no manual step", () => {
  // AC3: outlet 501/9 did not exist when the franchise-wide assignment was
  // made. Resolution is a lookup, not a copied column, so it inherits.
  const resolution = resolvePlanForOutlet([assignment({ id: "10" })], "9")
  assert.equal(resolution.status, "resolved")
})

test("an outlet-scope assignment beats a franchise-scope one", () => {
  // AC2: outlet 501/3 is on Plan B, outlet 501/4 stays on Plan A.
  const franchiseWide = assignment({ id: "10", planId: "planA" })
  const outletSpecific = assignment({
    id: "11",
    planId: "planB",
    scope: "outlet",
    outletId: "3",
  })
  const both = [franchiseWide, outletSpecific]

  const three = resolvePlanForOutlet(both, "3")
  assert.equal(three.status, "resolved")
  assert.equal(three.status === "resolved" ? three.assignment.planId : null, "planB")
  assert.equal(three.status === "resolved" ? three.source : null, "outlet")

  const four = resolvePlanForOutlet(both, "4")
  assert.equal(four.status, "resolved")
  assert.equal(four.status === "resolved" ? four.assignment.planId : null, "planA")
  assert.equal(four.status === "resolved" ? four.source : null, "franchise")
})

test("an outlet-scope assignment for a different outlet does not leak across", () => {
  const forOutletThree = assignment({ id: "11", scope: "outlet", outletId: "3" })
  assert.deepEqual(resolvePlanForOutlet([forOutletThree], "4"), {
    status: "no_plan_assigned",
  })
})

test("an inactive assignment does not resolve", () => {
  const superseded = assignment({ id: "10", isActive: false })
  assert.deepEqual(resolvePlanForOutlet([superseded], "3"), {
    status: "no_plan_assigned",
  })
})

test("two active assignments at the same scope resolve deterministically", () => {
  // The application layer prevents this, because MySQL cannot: outlet_id NULL
  // is not a distinct value in a unique constraint. If one slips through, the
  // most recently created wins rather than whichever row came back first.
  const older = assignment({ id: "9", planId: "old" })
  const newer = assignment({ id: "10", planId: "new" })

  const forward = resolvePlanForOutlet([older, newer], "3")
  const reversed = resolvePlanForOutlet([newer, older], "3")

  assert.equal(forward.status === "resolved" ? forward.assignment.planId : null, "new")
  assert.equal(
    reversed.status === "resolved" ? reversed.assignment.planId : null,
    "new"
  )
})

test("compares assignment ids past the float-safe range", () => {
  const big = assignment({ id: "9007199254740993", planId: "big" })
  const bigger = assignment({ id: "9007199254740994", planId: "bigger" })

  const resolution = resolvePlanForOutlet([big, bigger], "3")
  assert.equal(
    resolution.status === "resolved" ? resolution.assignment.planId : null,
    "bigger"
  )
})

test("an unapproved override blocks pricing with its own reason", () => {
  // AC5: not "no plan assigned" -- somebody did assign a plan, it is the
  // override that is waiting on a person with the approve key.
  const pending = assignment({
    id: "10",
    overridePriceAnnuallyMinor: 72000,
    overrideReason: "Negotiated",
    approvalStatus: "pending",
  })

  assert.equal(
    resolvePlanForOutlet([pending], "3").status,
    "override_pending_approval"
  )
})

test("a rejected override blocks pricing with its own reason", () => {
  // Not "pending": somebody decided, and the queue must say so rather than
  // look as though the approval simply has not happened yet.
  const rejected = assignment({
    id: "10",
    overridePriceAnnuallyMinor: 72000,
    approvalStatus: "rejected",
  })
  assert.equal(
    resolvePlanForOutlet([rejected], "3").status,
    "override_rejected"
  )
})

test("an approved override resolves normally", () => {
  const approved = assignment({
    id: "10",
    overridePriceAnnuallyMinor: 72000,
    approvalStatus: "approved",
  })
  assert.equal(resolvePlanForOutlet([approved], "3").status, "resolved")
})

test("an override within threshold never needed approval and resolves", () => {
  const small = assignment({
    id: "10",
    overridePriceAnnuallyMinor: 100000,
    approvalStatus: "not_required",
  })
  assert.equal(resolvePlanForOutlet([small], "3").status, "resolved")
})

// ---------------------------------------------------------------------------
// Available terms
// ---------------------------------------------------------------------------

test("a plan holding both prices offers both terms", () => {
  assert.deepEqual(availableTerms(plan(), assignment()), [
    "annually",
    "bi_annually",
  ])
})

test("a plan with no bi-annual price does not offer six months", () => {
  // AC11: the 6-month option is not presented at all, so a merchant cannot
  // select a term that would resolve to no amount.
  const annualOnly = plan({ priceBiAnnuallyMinor: null })
  assert.deepEqual(availableTerms(annualOnly, assignment()), ["annually"])
})

test("an assignment override supplies a term the catalog does not price", () => {
  const annualOnly = plan({ priceBiAnnuallyMinor: null })
  const withOverride = assignment({ overridePriceBiAnnuallyMinor: 65000 })
  assert.deepEqual(availableTerms(annualOnly, withOverride), [
    "annually",
    "bi_annually",
  ])
})

// ---------------------------------------------------------------------------
// Price resolution
// ---------------------------------------------------------------------------

test("with no override the catalog price applies", () => {
  const result = resolvePriceForLine({
    plan: plan(),
    assignment: assignment(),
    term: "annually",
    thresholdPercent: DEFAULT_THRESHOLD,
  })

  assert.equal(result.status, "resolved")
  if (result.status !== "resolved") return
  assert.equal(result.effectiveMinor, 120000)
  assert.equal(result.catalogMinor, 120000)
  assert.equal(result.adjustmentMinor, 0)
  assert.equal(result.source, "catalog")
  assert.equal(result.requiresApproval, false)
})

test("the bi-annual term prices from the bi-annual price", () => {
  const result = resolvePriceForLine({
    plan: plan(),
    assignment: assignment(),
    term: "bi_annually",
    thresholdPercent: DEFAULT_THRESHOLD,
  })
  assert.equal(result.status === "resolved" ? result.effectiveMinor : null, 70000)
})

test("an assignment override applies every cycle and records the difference", () => {
  // AC4: catalog RM1,200.00, approved override RM1,000.00, RM200.00 of
  // override value reported per cycle.
  const result = resolvePriceForLine({
    plan: plan(),
    assignment: assignment({
      overridePriceAnnuallyMinor: 100000,
      approvalStatus: "approved",
    }),
    term: "annually",
    thresholdPercent: DEFAULT_THRESHOLD,
  })

  assert.equal(result.status, "resolved")
  if (result.status !== "resolved") return
  assert.equal(result.catalogMinor, 120000)
  assert.equal(result.effectiveMinor, 100000)
  assert.equal(result.adjustmentMinor, -20000)
  assert.equal(result.source, "assignment_override")
})

test("a cycle override wins over the assignment override", () => {
  // AC14: measured against the assignment price of RM1,000.00, a cycle
  // override of RM1,150.00 is +150.00, not -50.00 against the catalog.
  const result = resolvePriceForLine({
    plan: plan(),
    assignment: assignment({
      overridePriceAnnuallyMinor: 100000,
      approvalStatus: "approved",
    }),
    term: "annually",
    cycleOverrideMinor: 115000,
    thresholdPercent: DEFAULT_THRESHOLD,
  })

  assert.equal(result.status, "resolved")
  if (result.status !== "resolved") return
  assert.equal(result.effectiveMinor, 115000)
  assert.equal(result.catalogMinor, 100000)
  assert.equal(result.adjustmentMinor, 15000)
  assert.equal(result.source, "cycle_override")
})

test("the next cycle reverts to the assignment price with no manual reset", () => {
  // The same assignment, priced again with no cycle override.
  const withAssignmentOverride = assignment({
    overridePriceAnnuallyMinor: 100000,
    approvalStatus: "approved",
  })

  const thisCycle = resolvePriceForLine({
    plan: plan(),
    assignment: withAssignmentOverride,
    term: "annually",
    cycleOverrideMinor: 115000,
    thresholdPercent: DEFAULT_THRESHOLD,
  })
  const nextCycle = resolvePriceForLine({
    plan: plan(),
    assignment: withAssignmentOverride,
    term: "annually",
    thresholdPercent: DEFAULT_THRESHOLD,
  })

  assert.equal(thisCycle.status === "resolved" ? thisCycle.effectiveMinor : null, 115000)
  assert.equal(nextCycle.status === "resolved" ? nextCycle.effectiveMinor : null, 100000)
})

test("a plan with no price for the requested term reports that reason", () => {
  const result = resolvePriceForLine({
    plan: plan({ priceBiAnnuallyMinor: null }),
    assignment: assignment(),
    term: "bi_annually",
    thresholdPercent: DEFAULT_THRESHOLD,
  })
  assert.deepEqual(result, {
    status: "plan_missing_term_price",
    term: "bi_annually",
  })
})

test("a variance beyond the threshold is flagged in both directions", () => {
  // AC15: +25% and -25% are treated identically.
  const increase = resolvePriceForLine({
    plan: plan(),
    assignment: assignment({ overridePriceAnnuallyMinor: 150000 }),
    term: "annually",
    thresholdPercent: DEFAULT_THRESHOLD,
  })
  const reduction = resolvePriceForLine({
    plan: plan(),
    assignment: assignment({ overridePriceAnnuallyMinor: 90000 }),
    term: "annually",
    thresholdPercent: DEFAULT_THRESHOLD,
  })

  assert.equal(increase.status === "resolved" ? increase.requiresApproval : null, true)
  assert.equal(reduction.status === "resolved" ? reduction.requiresApproval : null, true)
  assert.equal(increase.status === "resolved" ? increase.adjustmentMinor : null, 30000)
  assert.equal(reduction.status === "resolved" ? reduction.adjustmentMinor : null, -30000)
})

test("a variance inside the threshold needs no approval", () => {
  const result = resolvePriceForLine({
    plan: plan(),
    assignment: assignment({ overridePriceAnnuallyMinor: 114000 }),
    term: "annually",
    thresholdPercent: DEFAULT_THRESHOLD,
  })
  assert.equal(result.status === "resolved" ? result.requiresApproval : null, false)
})

test("a variance exactly at the threshold needs no approval", () => {
  // 15% of RM1,200.00 is RM180.00, landing on RM1,020.00.
  const result = resolvePriceForLine({
    plan: plan(),
    assignment: assignment({ overridePriceAnnuallyMinor: 102000 }),
    term: "annually",
    thresholdPercent: DEFAULT_THRESHOLD,
  })
  assert.equal(result.status === "resolved" ? result.variancePercent : null, 15)
  assert.equal(result.status === "resolved" ? result.requiresApproval : null, false)
})

test("the approval check is available before any invoice exists", () => {
  assert.equal(requiresOverrideApproval(120000, 72000, DEFAULT_THRESHOLD), true)
  assert.equal(requiresOverrideApproval(120000, 110000, DEFAULT_THRESHOLD), false)
  assert.equal(requiresOverrideApproval(null, 110000, DEFAULT_THRESHOLD), false)
})
