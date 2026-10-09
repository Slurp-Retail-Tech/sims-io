import assert from "node:assert/strict"
import test from "node:test"

import {
  overrideDirection,
  validateAssignmentInput,
  validatePlanInput,
} from "./plan-validation.ts"
import type { AssignmentInput, PlanInput } from "./plan-validation.ts"

function planInput(overrides: Partial<PlanInput> = {}): PlanInput {
  return {
    planCode: "ESS-STD",
    planName: "Essential Standard",
    licensePlan: "essential",
    priceAnnually: "1200.00",
    priceBiAnnually: "700.00",
    ...overrides,
  }
}

function assignmentInput(
  overrides: Partial<AssignmentInput> = {}
): AssignmentInput {
  return {
    planId: "1",
    scope: "franchise",
    franchiseId: "501",
    ...overrides,
  }
}

function errorFields(result: { ok: boolean; errors?: { field: string }[] }) {
  return (result.errors ?? []).map((error) => error.field)
}

// ---------------------------------------------------------------------------
// Plans
// ---------------------------------------------------------------------------

test("accepts a plan carrying both term prices", () => {
  const result = validatePlanInput(planInput())
  assert.equal(result.ok, true)
  if (!result.ok) return
  assert.equal(result.value.priceAnnuallyMinor, 120000)
  assert.equal(result.value.priceBiAnnuallyMinor, 70000)
  assert.equal(result.value.isActive, true)
})

test("accepts a plan pricing only one term", () => {
  // Deliberately allowed: the renewal page then offers only that term.
  const result = validatePlanInput(planInput({ priceBiAnnually: "" }))
  assert.equal(result.ok, true)
  assert.equal(result.ok ? result.value.priceBiAnnuallyMinor : "x", null)
})

test("rejects a plan pricing neither term", () => {
  // Such a plan could be assigned and would resolve to no amount, stranding
  // the outlet in Actions Required for a reason invisible from this screen.
  const result = validatePlanInput(
    planInput({ priceAnnually: null, priceBiAnnually: null })
  )
  assert.equal(result.ok, false)
  assert.ok(errorFields(result).includes("priceAnnually"))
})

test("requires a code, a name and a licence tier", () => {
  const result = validatePlanInput(
    planInput({ planCode: "  ", planName: "", licensePlan: "gold" })
  )
  assert.equal(result.ok, false)
  const fields = errorFields(result)
  assert.ok(fields.includes("planCode"))
  assert.ok(fields.includes("planName"))
  assert.ok(fields.includes("licensePlan"))
})

test("rejects a plan code that would not survive a URL or an export", () => {
  assert.equal(validatePlanInput(planInput({ planCode: "ESS STD" })).ok, false)
  assert.equal(validatePlanInput(planInput({ planCode: "-ESS" })).ok, false)
  assert.equal(validatePlanInput(planInput({ planCode: "ESS/STD" })).ok, false)
  assert.equal(validatePlanInput(planInput({ planCode: "ESS_STD.2" })).ok, true)
})

test("rejects a negative or unparseable price", () => {
  assert.equal(validatePlanInput(planInput({ priceAnnually: "-1" })).ok, false)
  assert.equal(validatePlanInput(planInput({ priceAnnually: "free" })).ok, false)
  assert.equal(
    validatePlanInput(planInput({ priceAnnually: "1200.005" })).ok,
    false
  )
  assert.equal(validatePlanInput(planInput({ priceAnnually: "1,200" })).ok, false)
})

test("accepts a zero price", () => {
  // A plan genuinely priced at zero is a business decision, not a typo.
  const result = validatePlanInput(planInput({ priceAnnually: "0.00" }))
  assert.equal(result.ok, true)
  assert.equal(result.ok ? result.value.priceAnnuallyMinor : "x", 0)
})

test("trims the strings it keeps", () => {
  const result = validatePlanInput(
    planInput({ planCode: "  ESS-STD  ", planName: "  Essential  " })
  )
  assert.equal(result.ok ? result.value.planCode : null, "ESS-STD")
  assert.equal(result.ok ? result.value.planName : null, "Essential")
})

// ---------------------------------------------------------------------------
// Assignments
// ---------------------------------------------------------------------------

test("accepts a franchise-scope assignment with no outlet", () => {
  const result = validateAssignmentInput(assignmentInput())
  assert.equal(result.ok, true)
  assert.equal(result.ok ? result.value.outletId : "x", null)
  assert.equal(result.ok ? result.value.defaultBillingPlan : null, "annually")
})

test("accepts an outlet-scope assignment naming its outlet", () => {
  const result = validateAssignmentInput(
    assignmentInput({ scope: "outlet", outletId: "3" })
  )
  assert.equal(result.ok, true)
  assert.equal(result.ok ? result.value.outletId : null, "3")
})

test("rejects an outlet-scope assignment with no outlet", () => {
  const result = validateAssignmentInput(assignmentInput({ scope: "outlet" }))
  assert.equal(result.ok, false)
  assert.ok(errorFields(result).includes("outletId"))
})

test("rejects a franchise-scope assignment that names an outlet", () => {
  // It would read as outlet-specific while resolving franchise-wide, and the
  // database cannot tell the two apart: outlet_id NULL is what encodes
  // "every outlet".
  const result = validateAssignmentInput(
    assignmentInput({ scope: "franchise", outletId: "3" })
  )
  assert.equal(result.ok, false)
  assert.ok(errorFields(result).includes("outletId"))
})

test("drops a stray outlet id rather than storing it on a franchise row", () => {
  const result = validateAssignmentInput(
    assignmentInput({ scope: "outlet", outletId: "3" })
  )
  assert.equal(result.ok ? result.value.scope : null, "outlet")
})

test("an override must say why", () => {
  // An unexplained departure from the catalog price is exactly what the
  // approval control exists to catch.
  const result = validateAssignmentInput(
    assignmentInput({ overridePriceAnnually: "1000.00" })
  )
  assert.equal(result.ok, false)
  assert.ok(errorFields(result).includes("overrideReason"))
})

test("an override with a reason is accepted and parsed", () => {
  const result = validateAssignmentInput(
    assignmentInput({
      overridePriceAnnually: "1000.00",
      overrideReason: "Negotiated at renewal, 2026",
    })
  )
  assert.equal(result.ok, true)
  if (!result.ok) return
  assert.equal(result.value.overridePriceAnnuallyMinor, 100000)
  assert.equal(result.value.overrideReason, "Negotiated at renewal, 2026")
})

test("a reason with no override is not stored as an override", () => {
  const result = validateAssignmentInput(
    assignmentInput({ overrideReason: "left over from an earlier edit" })
  )
  assert.equal(result.ok, true)
  assert.equal(result.ok ? result.value.overrideReason : "x", null)
})

test("rejects an unknown scope or default term", () => {
  assert.equal(validateAssignmentInput(assignmentInput({ scope: "group" })).ok, false)
  assert.equal(
    validateAssignmentInput(assignmentInput({ defaultBillingPlan: "monthly" })).ok,
    false
  )
})

test("requires a plan and a franchise", () => {
  const result = validateAssignmentInput(
    assignmentInput({ planId: "", franchiseId: "" })
  )
  assert.equal(result.ok, false)
  const fields = errorFields(result)
  assert.ok(fields.includes("planId"))
  assert.ok(fields.includes("franchiseId"))
})

// ---------------------------------------------------------------------------
// Override direction
// ---------------------------------------------------------------------------

test("records which way an override moves the price", () => {
  // Stored rather than inferred later, because Analytics must report increases
  // and reductions separately and the baseline may have changed by then.
  assert.equal(overrideDirection(120000, 100000), "decrease")
  assert.equal(overrideDirection(120000, 150000), "increase")
  assert.equal(overrideDirection(120000, 120000), null)
  assert.equal(overrideDirection(null, 100000), null)
  assert.equal(overrideDirection(120000, null), null)
})
