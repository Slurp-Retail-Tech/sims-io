import assert from "node:assert/strict"
import test from "node:test"

import type { AssignmentRecord, PlanRecord } from "./plan-resolution.ts"
import { availableTermsForInvoice, repriceInvoiceForTerm } from "./term-change.ts"
import type { LineContext } from "./term-change.ts"

const plan: PlanRecord = {
  id: "1",
  planCode: "ESS-STD",
  planName: "Essential Standard",
  licensePlan: "essential",
  priceAnnuallyMinor: 120000,
  priceBiAnnuallyMinor: 70000,
  isActive: true,
}

const annualOnly: PlanRecord = { ...plan, id: "2", priceBiAnnuallyMinor: null }

const assignment: AssignmentRecord = {
  id: "10",
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
}

function line(overrides: Partial<LineContext> = {}): LineContext {
  return {
    itemId: "100",
    outletId: "3",
    plan,
    assignment,
    cycleOverrideMinor: null,
    previousValidUntilDate: "2026-10-15",
    ...overrides,
  }
}

test("both terms are offered when every line has both prices", () => {
  assert.deepEqual(availableTermsForInvoice([line()], "annually"), ["annually", "bi_annually"])
})

test("a plan with no six-month price removes six months from the whole invoice", () => {
  assert.deepEqual(
    availableTermsForInvoice(
      [line(), line({ itemId: "101", outletId: "4", plan: annualOnly })],
      "annually"
    ),
    ["annually"]
  )
})

test("a cycle override pins the invoice to its current term", () => {
  assert.deepEqual(
    availableTermsForInvoice(
      [line(), line({ itemId: "101", outletId: "4", cycleOverrideMinor: 100000 })],
      "annually"
    ),
    ["annually"]
  )
})

test("switching to six months reprices every line and moves the period", () => {
  const result = repriceInvoiceForTerm({
    lines: [line(), line({ itemId: "101", outletId: "4", previousValidUntilDate: "2026-10-20" })],
    term: "bi_annually",
    taxRatePercent: 0,
    thresholdPercent: 15,
  })
  assert.ok(result.ok)
  if (!result.ok) return
  assert.equal(result.termMonths, 6)
  assert.deepEqual(result.lines.map((entry) => entry.effectiveMinor), [70000, 70000])
  assert.deepEqual(result.lines.map((entry) => entry.newValidUntilDate), ["2027-04-15", "2027-04-20"])
  assert.equal(result.totals.subtotalMinor, 140000)
  assert.equal(result.totals.totalMinor, 140000)
  assert.equal(result.periodStart, "2026-10-15")
  assert.equal(result.periodEnd, "2027-04-15")
})

test("an assignment override on the target term is honoured, with the adjustment recorded", () => {
  const discounted: AssignmentRecord = {
    ...assignment,
    overridePriceBiAnnuallyMinor: 65000,
    overrideReason: "Negotiated",
    approvalStatus: "approved",
  }
  const result = repriceInvoiceForTerm({
    lines: [line({ assignment: discounted })],
    term: "bi_annually",
    taxRatePercent: 0,
    thresholdPercent: 15,
  })
  assert.ok(result.ok)
  if (!result.ok) return
  assert.equal(result.lines[0].effectiveMinor, 65000)
  assert.equal(result.lines[0].adjustmentMinor, -5000)
  assert.equal(result.lines[0].priceSource, "assignment_override")
})

test("tax is applied on the repriced subtotal", () => {
  const result = repriceInvoiceForTerm({
    lines: [line()],
    term: "bi_annually",
    taxRatePercent: 8,
    thresholdPercent: 15,
  })
  assert.ok(result.ok)
  if (!result.ok) return
  assert.equal(result.totals.taxMinor, 5600)
  assert.equal(result.totals.totalMinor, 75600)
})

test("a term no line can be priced on is refused, naming the outlet", () => {
  const result = repriceInvoiceForTerm({
    lines: [line(), line({ itemId: "101", outletId: "4", plan: annualOnly })],
    term: "bi_annually",
    taxRatePercent: 0,
    thresholdPercent: 15,
  })
  assert.deepEqual(result, { ok: false, reason: "term_unavailable", outletId: "4" })
})

test("a switch whose repriced line would need approval is refused", () => {
  // The six-month override is 40% off catalog: beyond the threshold, and it
  // was never approved, so the merchant cannot reach it by switching terms.
  const steep: AssignmentRecord = {
    ...assignment,
    overridePriceBiAnnuallyMinor: 42000,
    overrideReason: "Too steep",
    approvalStatus: "pending",
  }
  const result = repriceInvoiceForTerm({
    lines: [line({ assignment: steep })],
    term: "bi_annually",
    taxRatePercent: 0,
    thresholdPercent: 15,
  })
  assert.deepEqual(result, { ok: false, reason: "requires_approval", outletId: "3" })
})
