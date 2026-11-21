import assert from "node:assert/strict"
import test from "node:test"

import type { DueSubscription } from "./invoice-build.ts"
import { checkSelection, manualDueDate, manualGroupKey, outletBlockReason, priceOutletForTerm } from "./manual-renewal.ts"
import type { AssignmentRecord, PlanRecord } from "./plan-resolution.ts"

const subscription: DueSubscription = {
  outletSubscriptionId: "1",
  franchiseId: "11007",
  outletId: "24132",
  centralId: null,
  outletName: "Bangsar",
  companyName: "Teh Tarik House",
  validUntilDate: "2026-12-01",
  billedBy: "slurp",
  billingHold: false,
}

const plan: PlanRecord = {
  id: "p1",
  planCode: "ESS",
  planName: "Essential",
  licensePlan: "essential",
  priceAnnuallyMinor: 120000,
  priceBiAnnuallyMinor: null,
  isActive: true,
}

const assignment: AssignmentRecord = {
  id: "a1",
  planId: "p1",
  scope: "franchise",
  franchiseId: "11007",
  outletId: null,
  overridePriceAnnuallyMinor: null,
  overridePriceBiAnnuallyMinor: null,
  overrideReason: null,
  defaultBillingPlan: "annually",
  approvalStatus: "not_required",
  isActive: true,
}

const plans = new Map([["p1", plan]])

test("prices an outlet from its plan on the chosen term", () => {
  const priced = priceOutletForTerm({ subscription, assignments: [assignment], plans, term: "annually", thresholdPercent: 15 })
  assert.ok(priced.ok)
  assert.equal(priced.line.effectiveAmountMinor, 120000)
  assert.equal(priced.line.previousValidUntilDate, "2026-12-01")
  assert.equal(priced.planName, "Essential")
})

test("refuses a term the plan has no price for, and an outlet with no plan", () => {
  const sixMonths = priceOutletForTerm({ subscription, assignments: [assignment], plans, term: "bi_annually", thresholdPercent: 15 })
  assert.deepEqual(sixMonths, { ok: false, reason: "Essential has no 6-month price." })
  const none = priceOutletForTerm({ subscription, assignments: [], plans, term: "annually", thresholdPercent: 15 })
  assert.equal(none.ok, false)
})

test("refuses an override still waiting for approval", () => {
  const pending = { ...assignment, overridePriceAnnuallyMinor: 50000, approvalStatus: "pending" as const }
  const priced = priceOutletForTerm({ subscription, assignments: [pending], plans, term: "annually", thresholdPercent: 15 })
  assert.deepEqual(priced, { ok: false, reason: "Its price override is waiting for approval." })
})

test("reseller-billed and held outlets cannot be billed by Slurp", () => {
  assert.equal(outletBlockReason(subscription), null)
  assert.match(outletBlockReason({ ...subscription, billedBy: "reseller" }) ?? "", /reseller/)
  assert.match(outletBlockReason({ ...subscription, billingHold: true }) ?? "", /hold/)
})

test("a selection must name live outlets sharing one expiry", () => {
  const other = { ...subscription, outletId: "24133", validUntilDate: "2027-01-15" }
  assert.deepEqual(checkSelection([subscription], ["24132"]), { ok: true, validUntilDate: "2026-12-01" })
  assert.equal(checkSelection([], []).ok, false)
  assert.match((checkSelection([subscription], ["24132", "99999"]) as { message: string }).message, /99999/)
  assert.match((checkSelection([subscription, other], ["24132", "24133"]) as { message: string }).message, /different dates/)
})

test("the group key matches the one the nightly cycle would claim", () => {
  const common = { franchiseId: "11007", validUntilDate: "2026-12-01", term: "annually" as const }
  assert.equal(manualGroupKey({ ...common, outletIds: ["24132"], groupingEnabled: false }), "11007|2026-12-01|24132")
  assert.equal(manualGroupKey({ ...common, outletIds: ["24132"], groupingEnabled: true }), "11007|2026-12-01|annually")
  assert.equal(manualGroupKey({ ...common, outletIds: ["24132", "24133"], groupingEnabled: false }), "11007|2026-12-01|annually")
})

test("a lapsed outlet brought back is due from today, not from its old expiry", () => {
  assert.equal(manualDueDate("2026-12-01", "2026-10-22"), "2026-12-01")
  assert.equal(manualDueDate("2026-08-01", "2026-10-22"), "2026-10-22")
})
