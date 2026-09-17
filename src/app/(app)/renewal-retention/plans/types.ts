/**
 * Client-side shapes for the plan catalog.
 *
 * Re-declared rather than imported from `src/lib/renewal/*`, matching the
 * split the Contacts module uses: the lib types carry server-only concerns and
 * pulling them into a client bundle drags their dependencies with them.
 */

export type BillingTerm = "annually" | "bi_annually"
export type AssignmentScope = "outlet" | "franchise"
export type ApprovalStatus = "not_required" | "pending" | "approved" | "rejected"

export type Plan = {
  id: string
  planCode: string
  planName: string
  licensePlan: string
  priceAnnuallyMinor: number | null
  priceBiAnnuallyMinor: number | null
  isActive: boolean
  currencyCode: string
  description: string | null
  createdAt: string
  updatedAt: string
  assignmentCount: number
}

export type Assignment = {
  id: string
  planId: string
  scope: AssignmentScope
  franchiseId: string
  outletId: string | null
  franchiseName: string | null
  outletName: string | null
  overridePriceAnnuallyMinor: number | null
  overridePriceBiAnnuallyMinor: number | null
  overrideReason: string | null
  overrideDirection: "increase" | "decrease" | null
  defaultBillingPlan: BillingTerm
  approvalStatus: ApprovalStatus
  isActive: boolean
  approvedByUserId: string | null
  approvedAt: string | null
  createdAt: string
  plan: {
    planCode: string
    planName: string
    licensePlan: string
    priceAnnuallyMinor: number | null
    priceBiAnnuallyMinor: number | null
  } | null
}

export type FieldError = { field: string; message: string }

export const LICENSE_PLANS = ["essential", "meal", "premium", "feast"] as const

export const LICENSE_PLAN_LABELS: Record<string, string> = {
  essential: "Essential",
  meal: "Meal",
  premium: "Premium",
  feast: "Feast",
}

export const TERM_LABELS: Record<BillingTerm, string> = {
  annually: "1 year",
  bi_annually: "6 months",
}
