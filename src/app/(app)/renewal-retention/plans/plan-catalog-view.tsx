"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { AlertTriangle, Check, ChevronRight, Plus, X } from "lucide-react"

import { useToast } from "@/components/toast-provider"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"

import { formatMinor } from "./format"
import { PlanDialog } from "./plan-dialog"
import type { Assignment, Plan } from "./types"

type PlanCatalogViewProps = {
  canManage: boolean
  canApprove: boolean
}

type LoadState = "loading" | "ready" | "error"

/**
 * The plan catalog: the price list, and which plans are waiting on an
 * approval. Opening a plan goes to its own page for its assignments — see
 * `plan-detail-view.tsx`.
 *
 * Capabilities arrive from the server page rather than being inferred here.
 * The buttons a viewer cannot use are not rendered, but the API enforces the
 * same keys regardless — this only decides what is worth showing.
 */
export function PlanCatalogView({ canManage, canApprove }: PlanCatalogViewProps) {
  const router = useRouter()
  const { showToast } = useToast()
  const [plans, setPlans] = React.useState<Plan[]>([])
  const [pending, setPending] = React.useState<Assignment[]>([])
  const [state, setState] = React.useState<LoadState>("loading")
  const [error, setError] = React.useState<string | null>(null)
  const [search, setSearch] = React.useState("")
  const [showInactive, setShowInactive] = React.useState(false)

  const [dialogOpen, setDialogOpen] = React.useState(false)
  const [editing, setEditing] = React.useState<Plan | null>(null)

  const load = React.useCallback(async () => {
    setState("loading")
    setError(null)
    try {
      const [plansResponse, pendingResponse] = await Promise.all([
        fetch(`/api/renewals/plans?includeInactive=true`, { cache: "no-store" }),
        fetch(`/api/renewals/plans/assignments?pending=true`, { cache: "no-store" }),
      ])

      if (!plansResponse.ok) {
        throw new Error("Unable to load the catalog.")
      }

      const plansPayload = (await plansResponse.json()) as { plans: Plan[] }
      setPlans(plansPayload.plans ?? [])

      if (pendingResponse.ok) {
        const payload = (await pendingResponse.json()) as { assignments: Assignment[] }
        setPending(payload.assignments ?? [])
      }

      setState("ready")
    } catch (loadError) {
      setError(
        loadError instanceof Error ? loadError.message : "Unable to load the catalog."
      )
      setState("error")
    }
  }, [])

  React.useEffect(() => {
    void load()
  }, [load])

  const visiblePlans = React.useMemo(() => {
    const term = search.trim().toLowerCase()
    return plans.filter((plan) => {
      if (!showInactive && !plan.isActive) {
        return false
      }
      if (!term) {
        return true
      }
      return (
        plan.planCode.toLowerCase().includes(term) ||
        plan.planName.toLowerCase().includes(term)
      )
    })
  }, [plans, search, showInactive])

  async function decideOverride(
    assignment: Assignment,
    decision: "approved" | "rejected"
  ) {
    const response = await fetch(
      `/api/renewals/plans/assignments/${assignment.id}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision }),
      }
    )
    if (response.ok) {
      void load()
    }
  }

  const activeCount = plans.filter((plan) => plan.isActive).length
  const inactiveCount = plans.length - activeCount
  const assignmentsTotal = plans.reduce((sum, plan) => sum + plan.assignmentCount, 0)

  return (
    <div className="animate-in fade-in slide-in-from-bottom-2 flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Plan Catalog</h1>
          <p className="text-muted-foreground text-sm">
            A plan is defined once, carrying both the annual and the bi-annual price. Open a
            plan to manage its assignments.
          </p>
        </div>
        {canManage ? (
          <Button
            size="sm"
            onClick={() => {
              setEditing(null)
              setDialogOpen(true)
            }}
          >
            <Plus className="size-4" />
            New plan
          </Button>
        ) : null}
      </div>

      {pending.length > 0 ? (
        <Card className="border-amber-300 bg-amber-50/60 dark:bg-amber-950/20">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <AlertTriangle className="size-4 text-amber-600" />
              {pending.length} agreed{" "}
              {pending.length === 1 ? "price" : "prices"} waiting for approval
            </CardTitle>
            <CardDescription>
              These assignments do not price anything until a decision is recorded. Outlets
              they cover stay in Actions Required meanwhile.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {pending.map((assignment) => (
              <div
                key={assignment.id}
                className="bg-background flex flex-wrap items-center justify-between gap-3 rounded-md border p-3"
              >
                <div className="min-w-0">
                  <div className="text-sm font-medium">
                    {assignment.plan?.planName ?? "Unknown plan"}{" "}
                    <span className="text-muted-foreground font-normal">
                      · {scopeLabel(assignment)}
                    </span>
                  </div>
                  <div className="text-muted-foreground text-xs">
                    {describeOverride(assignment)}
                  </div>
                  {assignment.overrideReason ? (
                    <div className="text-muted-foreground mt-1 text-xs italic">
                      “{assignment.overrideReason}”
                    </div>
                  ) : null}
                </div>
                {canApprove ? (
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => void decideOverride(assignment, "rejected")}
                    >
                      <X className="size-4" />
                      Reject
                    </Button>
                    <Button
                      size="sm"
                      onClick={() => void decideOverride(assignment, "approved")}
                    >
                      <Check className="size-4" />
                      Approve
                    </Button>
                  </div>
                ) : (
                  <span className="text-muted-foreground text-xs">
                    Needs someone with override approval
                  </span>
                )}
              </div>
            ))}
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardContent className="pt-6">
          <div className="mb-1 flex flex-wrap items-center justify-between gap-3">
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search code or name"
              className="h-8 w-56"
            />
            <label className="text-muted-foreground flex items-center gap-2 text-xs">
              <input
                type="checkbox"
                className="size-3.5"
                checked={showInactive}
                onChange={(event) => setShowInactive(event.target.checked)}
              />
              Show retired
            </label>
          </div>

          {state === "loading" ? (
            <p className="text-muted-foreground py-6 text-sm">Loading plans…</p>
          ) : state === "error" ? (
            <div className="py-6">
              <p className="text-destructive text-sm">{error}</p>
              <Button size="sm" variant="outline" className="mt-3" onClick={() => void load()}>
                Try again
              </Button>
            </div>
          ) : visiblePlans.length === 0 ? (
            <p className="text-muted-foreground py-6 text-sm">
              {plans.length === 0
                ? "No plans yet. Create one to start pricing renewals."
                : "No plans match that search."}
            </p>
          ) : (
            <div className="flex flex-col">
              <div className="text-muted-foreground grid grid-cols-[minmax(9rem,1fr)_6rem_6rem_7.5rem] gap-3 border-b px-1 pb-2.5 text-[11px] tracking-[0.05em] uppercase">
                <span>Plan</span>
                <span className="text-right">Annual</span>
                <span className="text-right">Bi-annual</span>
                <span className="text-right">Status</span>
              </div>
              {visiblePlans.map((plan) => (
                <button
                  key={plan.id}
                  type="button"
                  onClick={() => router.push(`/renewal-retention/plans/${plan.id}`)}
                  className={cn(
                    "grid w-full grid-cols-[minmax(9rem,1fr)_6rem_6rem_7.5rem] items-center gap-3 border-b px-1 py-3.5 text-left text-sm",
                    !plan.isActive && "opacity-60"
                  )}
                >
                  <span className="flex min-w-0 flex-col gap-0.5">
                    <span className="font-medium">{plan.planName}</span>
                    <span className="text-muted-foreground text-xs">
                      <span className="font-mono">{plan.planCode}</span> · {plan.licensePlan}
                    </span>
                    <span className="text-muted-foreground text-xs">
                      {plan.assignmentCount} {plan.assignmentCount === 1 ? "assignment" : "assignments"}
                    </span>
                  </span>
                  <span className="text-right tabular-nums whitespace-nowrap">
                    {formatMinor(plan.priceAnnuallyMinor, plan.currencyCode)}
                  </span>
                  <span
                    className={cn(
                      "text-right tabular-nums whitespace-nowrap",
                      plan.priceBiAnnuallyMinor === null && "text-amber-700 dark:text-amber-400"
                    )}
                  >
                    {plan.priceBiAnnuallyMinor === null
                      ? "Not priced"
                      : formatMinor(plan.priceBiAnnuallyMinor, plan.currencyCode)}
                  </span>
                  <span className="text-muted-foreground flex items-center justify-end gap-2">
                    <span
                      className={cn(
                        "rounded-full px-2 py-0.5 text-[11px] font-medium whitespace-nowrap",
                        plan.isActive
                          ? "bg-emerald-500/15 text-emerald-800 dark:text-emerald-200"
                          : "bg-muted-foreground/10"
                      )}
                    >
                      {plan.isActive ? "Active" : "Retired"}
                    </span>
                    <ChevronRight className="size-4 shrink-0" />
                  </span>
                </button>
              ))}
              <div className="pt-3.5 text-xs text-muted-foreground">
                {activeCount} active {activeCount === 1 ? "plan" : "plans"} ·{" "}
                {assignmentsTotal} {assignmentsTotal === 1 ? "assignment" : "assignments"} in
                total
                {inactiveCount > 0
                  ? ` · ${inactiveCount} ${inactiveCount === 1 ? "plan" : "plans"} closed to new assignments`
                  : ""}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <PlanDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        plan={editing}
        onSaved={() => {
          showToast(editing ? "Plan updated." : "Plan created.", "success")
          void load()
        }}
      />
    </div>
  )
}

/**
 * Name the scope by merchant and outlet, with the ids alongside.
 *
 * The id is what the row is keyed on and what an agent types to reproduce it,
 * so it stays visible; the name is what makes the row recognisable at a glance.
 */
export function scopeLabel(assignment: Assignment): string {
  const franchise = assignment.franchiseName
    ? `${assignment.franchiseName} (${assignment.franchiseId})`
    : `Franchise ${assignment.franchiseId}`
  if (assignment.scope === "franchise") {
    return `${franchise}, all outlets`
  }
  const outlet = assignment.outletName
    ? `${assignment.outletName} (${assignment.outletId})`
    : `outlet ${assignment.outletId}`
  return `${franchise} · ${outlet}`
}

/**
 * Describe an override in the direction it actually moves the price.
 *
 * Never the word "discount" unless it is one: an override may raise the
 * catalog price as readily as lower it, and Analytics reports the two
 * separately rather than netting them.
 */
export function describeOverride(assignment: Assignment): string {
  const parts: string[] = []
  if (assignment.overridePriceAnnuallyMinor !== null) {
    parts.push(`1 year ${formatMinor(assignment.overridePriceAnnuallyMinor)}`)
  }
  if (assignment.overridePriceBiAnnuallyMinor !== null) {
    parts.push(`6 months ${formatMinor(assignment.overridePriceBiAnnuallyMinor)}`)
  }
  if (parts.length === 0) {
    return "Catalog price"
  }
  // "Agreed price" is the assignment-level price that applies every cycle,
  // named apart from the one-off price set on a single invoice line.
  const direction =
    assignment.overrideDirection === "increase"
      ? "Agreed price, above catalog"
      : assignment.overrideDirection === "decrease"
        ? "Agreed price, below catalog"
        : "Agreed price"
  return `${direction} · ${parts.join(", ")}`
}
