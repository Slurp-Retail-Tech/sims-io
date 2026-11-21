/**
 * The rules for a renewal document raised by hand rather than by the
 * nightly cycle.
 *
 * Staff raise one when a renewal falls outside the automatic window (an
 * early renewal, a lapsed outlet coming back, a proforma voided by mistake)
 * or when a merchant asks for a document now. It is priced exactly as the
 * cycle would price it, from the outlet's plan assignment, and refused for
 * the same reasons the cycle would block it, so a hand-raised document never
 * bills what the catalog does not allow.
 *
 * Pure and runtime-free so the rules are unit-tested; the database half is
 * `manual-renewal-data.ts`.
 */

import { buildGroupKey } from "./invoice-build.ts"
import type { DueSubscription, PricedLine } from "./invoice-build.ts"
import { resolvePlanForOutlet, resolvePriceForLine } from "./plan-resolution.ts"
import type { AssignmentRecord, BillingTerm, PlanRecord } from "./plan-resolution.ts"

export type OutletPricing =
  | { ok: true; line: PricedLine; planName: string }
  | { ok: false; reason: string }

/**
 * Price one outlet on a chosen term, as the cycle would: the outlet's plan
 * assignment, its override if approved, else the catalog.
 */
export function priceOutletForTerm(input: {
  subscription: DueSubscription
  assignments: readonly AssignmentRecord[]
  plans: ReadonlyMap<string, PlanRecord>
  term: BillingTerm
  thresholdPercent: number
}): OutletPricing {
  const { subscription, assignments, plans, term, thresholdPercent } = input
  const resolution = resolvePlanForOutlet(assignments, subscription.outletId)
  if (resolution.status === "no_plan_assigned") {
    return { ok: false, reason: "No plan is assigned to this outlet or its franchise." }
  }
  if (resolution.status === "override_pending_approval") {
    return { ok: false, reason: "Its price override is waiting for approval." }
  }
  if (resolution.status === "override_rejected") {
    return { ok: false, reason: "Its price override was rejected; assign the plan again." }
  }
  const plan = plans.get(resolution.assignment.planId)
  if (!plan) {
    return { ok: false, reason: "The assigned plan no longer exists." }
  }
  const price = resolvePriceForLine({ plan, assignment: resolution.assignment, term, thresholdPercent })
  if (price.status === "plan_missing_term_price") {
    return { ok: false, reason: `${plan.planName} has no ${term === "annually" ? "1-year" : "6-month"} price.` }
  }
  if (price.requiresApproval) {
    return { ok: false, reason: "Its price varies from the catalog beyond the threshold and needs approval." }
  }
  return {
    ok: true,
    planName: plan.planName,
    line: {
      outletSubscriptionId: subscription.outletSubscriptionId,
      franchiseId: subscription.franchiseId,
      outletId: subscription.outletId,
      centralId: subscription.centralId,
      outletName: subscription.outletName,
      planId: plan.id,
      assignmentId: resolution.assignment.id,
      licensePlan: plan.licensePlan,
      billingPlan: term,
      catalogAmountMinor: price.catalogMinor,
      effectiveAmountMinor: price.effectiveMinor,
      adjustmentAmountMinor: price.adjustmentMinor,
      priceSource: price.source,
      previousValidUntilDate: subscription.validUntilDate,
    },
  }
}

/** Why an outlet cannot be billed by Slurp at all, whatever its plan. */
export function outletBlockReason(subscription: DueSubscription): string | null {
  if (subscription.billedBy === "reseller") {
    return "Billed by the reseller, not by Slurp."
  }
  if (subscription.billingHold) {
    return "On billing hold."
  }
  if (!subscription.validUntilDate) {
    return "Has no expiry date to renew from."
  }
  return null
}

export type SelectionCheck =
  | { ok: true; validUntilDate: string }
  | { ok: false; message: string }

/**
 * One document renews outlets from one expiry, so every selected outlet must
 * share it: the period on the document runs from that date for the term.
 */
export function checkSelection(selected: readonly DueSubscription[], requested: readonly string[]): SelectionCheck {
  if (requested.length === 0) {
    return { ok: false, message: "Choose at least one outlet." }
  }
  const found = new Set(selected.map((subscription) => subscription.outletId))
  const missing = requested.filter((outletId) => !found.has(outletId))
  if (missing.length > 0) {
    return { ok: false, message: `Outlet ${missing.join(", ")} is not a live subscription under this franchise.` }
  }
  for (const subscription of selected) {
    const blocked = outletBlockReason(subscription)
    if (blocked) {
      return { ok: false, message: `Outlet ${subscription.outletId}: ${blocked}` }
    }
  }
  const dates = [...new Set(selected.map((subscription) => subscription.validUntilDate))]
  if (dates.length > 1) {
    return {
      ok: false,
      message: "These outlets expire on different dates. Raise one document per expiry date so each renews from its own.",
    }
  }
  return { ok: true, validUntilDate: dates[0] }
}

/**
 * The group key a hand-raised document claims, chosen to collide with the
 * one the nightly cycle would use for the same outlets, so the open guard
 * refuses a duplicate and the cycle reuses this document instead of raising
 * its own.
 */
export function manualGroupKey(input: {
  franchiseId: string
  validUntilDate: string
  outletIds: readonly string[]
  term: BillingTerm
  groupingEnabled: boolean
}): string {
  const base = buildGroupKey(input.franchiseId, input.validUntilDate)
  if (input.outletIds.length > 1 || input.groupingEnabled) {
    return `${base}|${input.term}`
  }
  return `${base}|${input.outletIds[0]}`
}

/**
 * A document's due date: the expiry it renews from, or today when that has
 * already passed, so a lapsed outlet brought back gets the full grace window
 * from now rather than lapsing again the night it is raised.
 */
export function manualDueDate(validUntilDate: string, today: string): string {
  return validUntilDate < today ? today : validUntilDate
}
