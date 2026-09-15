/**
 * Which plan an outlet is on, and what it should be charged.
 *
 * Two resolutions live here, and they are deliberately separate:
 *
 *  1. **Plan resolution** -- outlet-scope assignment, then franchise-scope,
 *     then none. Computed at read time rather than copied onto the outlet, so
 *     an outlet imported from the POS API *after* a franchise-wide assignment
 *     was made inherits it with no manual step. That inheritance is the whole
 *     reason this is a lookup and not a column.
 *
 *  2. **Price resolution** -- cycle override, then assignment override, then
 *     the catalog price. The winning source is returned alongside the amount
 *     so it can be written onto the invoice line; an amount nobody can explain
 *     without re-deriving it is an amount nobody can defend to a merchant.
 *
 * Both return discriminated unions rather than null, because the caller does
 * not just need to know that pricing failed -- it needs the specific reason to
 * put in the Actions Required queue. "No plan assigned" and "override waiting
 * for approval" are different problems with different people fixing them.
 *
 * Every amount is integer minor units; see `money.ts`.
 *
 * Pure and runtime-free so it can be unit-tested under `node --test`.
 */

import { adjustmentMinor, variancePercent } from "./money.ts"

export type BillingTerm = "annually" | "bi_annually"
export type AssignmentScope = "outlet" | "franchise"
export type ApprovalStatus = "not_required" | "pending" | "approved" | "rejected"
export type PriceSource = "cycle_override" | "assignment_override" | "catalog"

/** Months each term adds to the previous expiry date. */
export const TERM_MONTHS: Record<BillingTerm, number> = {
  annually: 12,
  bi_annually: 6,
}

export type PlanRecord = {
  id: string
  planCode: string
  planName: string
  licensePlan: string
  /** Null where the plan holds no price for that term. */
  priceAnnuallyMinor: number | null
  priceBiAnnuallyMinor: number | null
  isActive: boolean
}

export type AssignmentRecord = {
  id: string
  planId: string
  scope: AssignmentScope
  franchiseId: string
  /** Null for a franchise-scope assignment: every outlet in the franchise. */
  outletId: string | null
  overridePriceAnnuallyMinor: number | null
  overridePriceBiAnnuallyMinor: number | null
  overrideReason: string | null
  defaultBillingPlan: BillingTerm
  approvalStatus: ApprovalStatus
  isActive: boolean
}

export type PlanResolution =
  | {
      status: "resolved"
      assignment: AssignmentRecord
      /** Which scope won, so the UI can show where the price came from. */
      source: AssignmentScope
    }
  | { status: "no_plan_assigned" }
  | { status: "override_pending_approval"; assignment: AssignmentRecord }

export type PriceResolution =
  | {
      status: "resolved"
      catalogMinor: number
      effectiveMinor: number
      /** Effective less catalog: negative for a reduction, positive for an increase. */
      adjustmentMinor: number
      source: PriceSource
      /** Absolute variance from catalog, in percent. Null when catalog is zero. */
      variancePercent: number | null
      /** True when the variance exceeds the configured threshold. */
      requiresApproval: boolean
    }
  | { status: "plan_missing_term_price"; term: BillingTerm }

/** Catalog price for one term, or null where the plan does not offer it. */
export function catalogPriceForTerm(
  plan: PlanRecord,
  term: BillingTerm
): number | null {
  return term === "annually" ? plan.priceAnnuallyMinor : plan.priceBiAnnuallyMinor
}

/** Assignment override for one term, or null where none is set. */
export function assignmentOverrideForTerm(
  assignment: AssignmentRecord,
  term: BillingTerm
): number | null {
  return term === "annually"
    ? assignment.overridePriceAnnuallyMinor
    : assignment.overridePriceBiAnnuallyMinor
}

/** True where the assignment departs from the catalog on either term. */
export function hasOverride(assignment: AssignmentRecord): boolean {
  return (
    assignment.overridePriceAnnuallyMinor !== null ||
    assignment.overridePriceBiAnnuallyMinor !== null
  )
}

/**
 * Terms the merchant may actually be offered on the renewal page.
 *
 * A plan created with only an annual price does not offer six months, so the
 * switcher must not present a term that would resolve to no amount. The
 * assignment's override counts: a plan with no bi-annual catalog price but a
 * bi-annual override on the assignment does offer that term.
 */
export function availableTerms(
  plan: PlanRecord,
  assignment: AssignmentRecord | null
): BillingTerm[] {
  const terms: BillingTerm[] = []
  for (const term of ["annually", "bi_annually"] as const) {
    const override = assignment ? assignmentOverrideForTerm(assignment, term) : null
    if (override !== null || catalogPriceForTerm(plan, term) !== null) {
      terms.push(term)
    }
  }
  return terms
}

/**
 * Resolve which assignment prices an outlet: outlet-scope first, then
 * franchise-scope.
 *
 * `assignments` must already be narrowed to live, active rows for the outlet's
 * franchise; this function does not query and does not know about soft
 * deletes. It does filter on `isActive`, because a superseded assignment is
 * still a row the caller may have loaded.
 *
 * An outlet-scope and a franchise-scope assignment covering the same outlet
 * are valid and expected -- that is the whole point of the two scopes. Two
 * *active* assignments at the same scope are not; the application layer
 * prevents it, because MySQL will not treat `outlet_id` NULL as a distinct
 * value in a unique constraint. Should one slip through anyway, the most
 * recently created wins, so the result is at least deterministic rather than
 * dependent on row order.
 *
 * An assignment carrying an override that has not been approved does not
 * resolve for pricing at all. It is reported separately so the outlet lands in
 * Actions Required as `override_pending_approval` rather than being mistaken
 * for an outlet nobody has assigned a plan to.
 */
export function resolvePlanForOutlet(
  assignments: readonly AssignmentRecord[],
  outletId: string
): PlanResolution {
  const live = assignments.filter((assignment) => assignment.isActive)

  const winner =
    mostRecent(
      live.filter(
        (assignment) =>
          assignment.scope === "outlet" && assignment.outletId === outletId
      )
    ) ??
    mostRecent(
      live.filter(
        (assignment) =>
          assignment.scope === "franchise" && assignment.outletId === null
      )
    )

  if (!winner) {
    return { status: "no_plan_assigned" }
  }

  if (hasOverride(winner) && winner.approvalStatus !== "not_required") {
    if (winner.approvalStatus !== "approved") {
      return { status: "override_pending_approval", assignment: winner }
    }
  }

  return { status: "resolved", assignment: winner, source: winner.scope }
}

/**
 * Resolve the amount for one invoice line: cycle override, then assignment
 * override, then catalog.
 *
 * `catalogMinor` in the result is the price the override is measured against,
 * not always the plan's own catalog price: a cycle override on a line that
 * already carries an assignment override is a departure from the assignment
 * price, and that is what the merchant and the approver both mean by "off by
 * how much". This is what AC14 asserts -- a cycle override of RM1,150 against
 * an assignment override of RM1,000 is +150, not +(-50).
 *
 * `thresholdPercent` is the configured approval threshold, applied in absolute
 * terms so an increase needs the same approval as a reduction.
 */
export function resolvePriceForLine(input: {
  plan: PlanRecord
  assignment: AssignmentRecord | null
  term: BillingTerm
  /** A one-invoice-only override, set by Renewal on a draft or issued invoice. */
  cycleOverrideMinor?: number | null
  thresholdPercent: number
}): PriceResolution {
  const { plan, assignment, term, cycleOverrideMinor = null, thresholdPercent } = input

  const planCatalog = catalogPriceForTerm(plan, term)
  const assignmentOverride = assignment
    ? assignmentOverrideForTerm(assignment, term)
    : null

  // What the override is measured against. The assignment price becomes the
  // baseline once it exists, so a cycle override is reported as a departure
  // from what this merchant actually pays.
  const baseline = assignmentOverride ?? planCatalog

  if (cycleOverrideMinor !== null) {
    if (baseline === null) {
      // Nothing to measure the override against, but the merchant still has a
      // price. Report it with a zero adjustment rather than blocking a line
      // somebody deliberately set.
      return {
        status: "resolved",
        catalogMinor: cycleOverrideMinor,
        effectiveMinor: cycleOverrideMinor,
        adjustmentMinor: 0,
        source: "cycle_override",
        variancePercent: null,
        requiresApproval: false,
      }
    }
    return settle(baseline, cycleOverrideMinor, "cycle_override", thresholdPercent)
  }

  if (assignmentOverride !== null) {
    if (planCatalog === null) {
      return {
        status: "resolved",
        catalogMinor: assignmentOverride,
        effectiveMinor: assignmentOverride,
        adjustmentMinor: 0,
        source: "assignment_override",
        variancePercent: null,
        requiresApproval: false,
      }
    }
    return settle(
      planCatalog,
      assignmentOverride,
      "assignment_override",
      thresholdPercent
    )
  }

  if (planCatalog === null) {
    return { status: "plan_missing_term_price", term }
  }

  return {
    status: "resolved",
    catalogMinor: planCatalog,
    effectiveMinor: planCatalog,
    adjustmentMinor: 0,
    source: "catalog",
    variancePercent: 0,
    requiresApproval: false,
  }
}

/**
 * Whether a proposed override needs sign-off before it may price anything.
 *
 * Exposed separately from `resolvePriceForLine` because the plans UI has to
 * answer this while the user is still typing, before any invoice exists.
 */
export function requiresOverrideApproval(
  catalogMinor: number | null,
  effectiveMinor: number | null,
  thresholdPercent: number
): boolean {
  const variance = variancePercent(catalogMinor, effectiveMinor)
  if (variance === null) {
    return false
  }
  return variance > thresholdPercent
}

function settle(
  catalogMinor: number,
  effectiveMinor: number,
  source: PriceSource,
  thresholdPercent: number
): PriceResolution {
  const variance = variancePercent(catalogMinor, effectiveMinor)
  return {
    status: "resolved",
    catalogMinor,
    effectiveMinor,
    adjustmentMinor: adjustmentMinor(catalogMinor, effectiveMinor),
    source,
    variancePercent: variance,
    requiresApproval: variance !== null && variance > thresholdPercent,
  }
}

/**
 * Highest id wins. Ids are BIGINT strings from mysql2, so they are compared by
 * length first and then lexically -- `Number` would lose precision past 2^53.
 */
function mostRecent(
  assignments: readonly AssignmentRecord[]
): AssignmentRecord | null {
  let winner: AssignmentRecord | null = null
  for (const assignment of assignments) {
    if (!winner || compareNumericIds(assignment.id, winner.id) > 0) {
      winner = assignment
    }
  }
  return winner
}

function compareNumericIds(left: string, right: string): number {
  const a = left.replace(/^0+(?=\d)/, "")
  const b = right.replace(/^0+(?=\d)/, "")
  if (a.length !== b.length) {
    return a.length - b.length
  }
  return a < b ? -1 : a > b ? 1 : 0
}
