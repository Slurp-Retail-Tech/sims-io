/**
 * Validation for the plan catalog and its assignments.
 *
 * Kept separate from the database layer for the usual reason in this codebase:
 * a module that imports `next/server` or uses the `@/` alias cannot be tested
 * under `node --test`. The rules here are the ones worth pinning -- a mandatory
 * override reason, a plan that must price at least one term, an assignment
 * whose outlet id must match its scope -- so they live where a test can reach
 * them.
 *
 * Every price is returned in integer minor units, already parsed, so callers
 * never re-parse a decimal string and never see a float.
 */

import { parseAmountToMinor } from "./money.ts"
import type { AssignmentScope, BillingTerm } from "./plan-resolution.ts"

export const LICENSE_PLANS = ["essential", "meal", "premium", "feast"] as const
export type LicensePlan = (typeof LICENSE_PLANS)[number]

export const BILLING_TERMS = ["annually", "bi_annually"] as const

/** DECIMAL(12,2) holds ten integer digits. */
const MAX_PRICE_MINOR = 9_999_999_999_99

export type FieldError = { field: string; message: string }

export type PlanInput = {
  planCode: unknown
  planName: unknown
  licensePlan: unknown
  priceAnnually: unknown
  priceBiAnnually: unknown
  description?: unknown
  isActive?: unknown
}

export type NormalizedPlanInput = {
  planCode: string
  planName: string
  licensePlan: LicensePlan
  priceAnnuallyMinor: number | null
  priceBiAnnuallyMinor: number | null
  description: string | null
  isActive: boolean
}

export type AssignmentInput = {
  planId: unknown
  scope: unknown
  franchiseId: unknown
  outletId?: unknown
  overridePriceAnnually?: unknown
  overridePriceBiAnnually?: unknown
  overrideReason?: unknown
  defaultBillingPlan?: unknown
}

export type NormalizedAssignmentInput = {
  planId: string
  scope: AssignmentScope
  franchiseId: string
  outletId: string | null
  overridePriceAnnuallyMinor: number | null
  overridePriceBiAnnuallyMinor: number | null
  overrideReason: string | null
  defaultBillingPlan: BillingTerm
}

export type PlanValidation =
  | { ok: true; value: NormalizedPlanInput }
  | { ok: false; errors: FieldError[] }

export type AssignmentValidation =
  | { ok: true; value: NormalizedAssignmentInput }
  | { ok: false; errors: FieldError[] }

export function isLicensePlan(value: unknown): value is LicensePlan {
  return (
    typeof value === "string" && (LICENSE_PLANS as readonly string[]).includes(value)
  )
}

export function isBillingTerm(value: unknown): value is BillingTerm {
  return (
    typeof value === "string" && (BILLING_TERMS as readonly string[]).includes(value)
  )
}

/**
 * Validate a plan.
 *
 * A plan must price at least one term. One with neither price could be
 * assigned to an outlet and would then resolve to no amount at all, putting
 * that outlet into Actions Required for a reason nobody could act on from the
 * catalog screen.
 *
 * A plan pricing only one term is explicitly allowed: the renewal page then
 * offers only that term.
 */
export function validatePlanInput(input: PlanInput): PlanValidation {
  const errors: FieldError[] = []

  const planCode = cleanString(input.planCode)
  if (!planCode) {
    errors.push({ field: "planCode", message: "Plan code is required." })
  } else if (planCode.length > 64) {
    errors.push({ field: "planCode", message: "Plan code must be 64 characters or fewer." })
  } else if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(planCode)) {
    errors.push({
      field: "planCode",
      message:
        "Plan code may use letters, numbers, dots, dashes and underscores, and must start with a letter or number.",
    })
  }

  const planName = cleanString(input.planName)
  if (!planName) {
    errors.push({ field: "planName", message: "Plan name is required." })
  } else if (planName.length > 255) {
    errors.push({ field: "planName", message: "Plan name must be 255 characters or fewer." })
  }

  if (!isLicensePlan(input.licensePlan)) {
    errors.push({
      field: "licensePlan",
      message: `Licence tier must be one of: ${LICENSE_PLANS.join(", ")}.`,
    })
  }

  const annual = parseOptionalPrice(input.priceAnnually, "priceAnnually", errors)
  const biAnnual = parseOptionalPrice(
    input.priceBiAnnually,
    "priceBiAnnually",
    errors
  )

  if (annual === null && biAnnual === null) {
    errors.push({
      field: "priceAnnually",
      message: "A plan must have a price for at least one term.",
    })
  }

  const description = cleanString(input.description)
  if (description && description.length > 2000) {
    errors.push({
      field: "description",
      message: "Description must be 2000 characters or fewer.",
    })
  }

  if (errors.length > 0) {
    return { ok: false, errors }
  }

  return {
    ok: true,
    value: {
      planCode: planCode as string,
      planName: planName as string,
      licensePlan: input.licensePlan as LicensePlan,
      priceAnnuallyMinor: annual,
      priceBiAnnuallyMinor: biAnnual,
      description: description || null,
      isActive: input.isActive === undefined ? true : Boolean(input.isActive),
    },
  }
}

/**
 * Validate an assignment.
 *
 * Two rules carry weight:
 *
 *  - The outlet id must match the scope. A franchise-scope row with an outlet
 *    id would look outlet-specific to a reader while resolving as
 *    franchise-wide, and the database cannot tell them apart because
 *    `outlet_id` NULL is what encodes "every outlet".
 *  - An override must carry a reason. An unexplained departure from the
 *    catalog price is the thing the approval control exists to catch, and a
 *    reason recorded later is a reason invented later.
 */
export function validateAssignmentInput(
  input: AssignmentInput
): AssignmentValidation {
  const errors: FieldError[] = []

  const planId = cleanString(input.planId)
  if (!planId || !/^\d+$/.test(planId)) {
    errors.push({ field: "planId", message: "Select a plan." })
  }

  const scope = input.scope
  if (scope !== "outlet" && scope !== "franchise") {
    errors.push({ field: "scope", message: "Scope must be outlet or franchise." })
  }

  const franchiseId = cleanString(input.franchiseId)
  if (!franchiseId) {
    errors.push({ field: "franchiseId", message: "Select a franchise." })
  } else if (franchiseId.length > 120) {
    errors.push({ field: "franchiseId", message: "Franchise id is too long." })
  }

  const outletId = cleanString(input.outletId)
  if (scope === "outlet" && !outletId) {
    errors.push({
      field: "outletId",
      message: "An outlet-scope assignment needs an outlet.",
    })
  }
  if (scope === "franchise" && outletId) {
    errors.push({
      field: "outletId",
      message:
        "A franchise-scope assignment covers every outlet, so it cannot name one.",
    })
  }
  if (outletId && outletId.length > 120) {
    errors.push({ field: "outletId", message: "Outlet id is too long." })
  }

  const overrideAnnual = parseOptionalPrice(
    input.overridePriceAnnually,
    "overridePriceAnnually",
    errors
  )
  const overrideBiAnnual = parseOptionalPrice(
    input.overridePriceBiAnnually,
    "overridePriceBiAnnually",
    errors
  )

  const overrideReason = cleanString(input.overrideReason)
  const hasOverride = overrideAnnual !== null || overrideBiAnnual !== null

  if (hasOverride && !overrideReason) {
    errors.push({
      field: "overrideReason",
      message: "A price override must say why.",
    })
  }
  if (overrideReason && overrideReason.length > 1000) {
    errors.push({
      field: "overrideReason",
      message: "Reason must be 1000 characters or fewer.",
    })
  }

  const defaultBillingPlan =
    input.defaultBillingPlan === undefined ? "annually" : input.defaultBillingPlan
  if (!isBillingTerm(defaultBillingPlan)) {
    errors.push({
      field: "defaultBillingPlan",
      message: "Default term must be annually or bi_annually.",
    })
  }

  if (errors.length > 0) {
    return { ok: false, errors }
  }

  return {
    ok: true,
    value: {
      planId: planId as string,
      scope: scope as AssignmentScope,
      franchiseId: franchiseId as string,
      outletId: scope === "outlet" ? (outletId as string) : null,
      overridePriceAnnuallyMinor: overrideAnnual,
      overridePriceBiAnnuallyMinor: overrideBiAnnual,
      overrideReason: hasOverride ? overrideReason : null,
      defaultBillingPlan: defaultBillingPlan as BillingTerm,
    },
  }
}

/**
 * Which way an override moves the price, for the record.
 *
 * Null where there is nothing to compare against, or where the override
 * happens to equal the catalog price. Analytics reports increases and
 * reductions separately and must never net them, so the direction is stored
 * rather than inferred later from an amount whose baseline has since changed.
 */
export function overrideDirection(
  catalogMinor: number | null,
  overrideMinor: number | null
): "increase" | "decrease" | null {
  if (catalogMinor === null || overrideMinor === null) {
    return null
  }
  if (overrideMinor > catalogMinor) {
    return "increase"
  }
  if (overrideMinor < catalogMinor) {
    return "decrease"
  }
  return null
}

function parseOptionalPrice(
  value: unknown,
  field: string,
  errors: FieldError[]
): number | null {
  if (value === undefined || value === null || value === "") {
    return null
  }
  if (typeof value !== "string" && typeof value !== "number") {
    errors.push({ field, message: "Price must be a number." })
    return null
  }

  const minor = parseAmountToMinor(value)
  if (minor === null) {
    errors.push({
      field,
      message: "Price must be a number with at most two decimal places.",
    })
    return null
  }
  if (minor < 0) {
    errors.push({ field, message: "Price cannot be negative." })
    return null
  }
  if (minor > MAX_PRICE_MINOR) {
    errors.push({ field, message: "Price is too large." })
    return null
  }
  return minor
}

function cleanString(value: unknown): string {
  return typeof value === "string" ? value.trim() : ""
}
