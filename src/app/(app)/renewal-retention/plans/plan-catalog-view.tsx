"use client"

import * as React from "react"
import { AlertTriangle, Check, Pencil, Plus, X } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Separator } from "@/components/ui/separator"
import { cn } from "@/lib/utils"

import { formatMinor } from "./format"
import { PlanDialog } from "./plan-dialog"
import { LICENSE_PLAN_LABELS, TERM_LABELS } from "./types"
import type { Assignment, Plan } from "./types"

type PlanCatalogViewProps = {
  canManage: boolean
  canApprove: boolean
}

type LoadState = "loading" | "ready" | "error"

/**
 * The plan catalog: the price list, who is on it, and anything waiting on an
 * approval.
 *
 * Capabilities arrive from the server page rather than being inferred here.
 * The buttons a viewer cannot use are not rendered, but the API enforces the
 * same keys regardless — this only decides what is worth showing.
 */
export function PlanCatalogView({ canManage, canApprove }: PlanCatalogViewProps) {
  const [plans, setPlans] = React.useState<Plan[]>([])
  const [assignments, setAssignments] = React.useState<Assignment[]>([])
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
      const [plansResponse, assignmentsResponse, pendingResponse] =
        await Promise.all([
          fetch(`/api/renewals/plans?includeInactive=true`, { cache: "no-store" }),
          fetch(`/api/renewals/plans/assignments`, { cache: "no-store" }),
          fetch(`/api/renewals/plans/assignments?pending=true`, {
            cache: "no-store",
          }),
        ])

      if (!plansResponse.ok) {
        throw new Error("Unable to load the catalog.")
      }

      const plansPayload = (await plansResponse.json()) as { plans: Plan[] }
      setPlans(plansPayload.plans ?? [])

      if (assignmentsResponse.ok) {
        const payload = (await assignmentsResponse.json()) as {
          assignments: Assignment[]
        }
        setAssignments(payload.assignments ?? [])
      }
      if (pendingResponse.ok) {
        const payload = (await pendingResponse.json()) as {
          assignments: Assignment[]
        }
        setPending(payload.assignments ?? [])
      }

      setState("ready")
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Unable to load the catalog."
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

  return (
    <div className="animate-in fade-in slide-in-from-bottom-2 flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Plan Catalog</h1>
          <p className="text-muted-foreground text-sm">
            Subscription prices, and which outlets and franchises are on them.
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
              {pending.length} price{" "}
              {pending.length === 1 ? "override" : "overrides"} waiting for
              approval
            </CardTitle>
            <CardDescription>
              These assignments do not price anything until a decision is
              recorded. Outlets they cover stay in Actions Required meanwhile.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {pending.map((assignment) => (
              <div
                key={assignment.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-md border bg-background p-3"
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
        <CardHeader className="gap-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <CardTitle className="text-base">Plans</CardTitle>
            <div className="flex items-center gap-3">
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
          </div>
        </CardHeader>
        <CardContent>
          {state === "loading" ? (
            <p className="text-muted-foreground py-6 text-sm">Loading plans…</p>
          ) : state === "error" ? (
            <div className="py-6">
              <p className="text-destructive text-sm">{error}</p>
              <Button
                size="sm"
                variant="outline"
                className="mt-3"
                onClick={() => void load()}
              >
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
              <div className="text-muted-foreground grid grid-cols-[1.2fr_1.6fr_0.8fr_0.8fr_0.8fr_auto] gap-3 px-1 pb-2 text-xs font-medium">
                <span>Code</span>
                <span>Name</span>
                <span>Tier</span>
                <span className="text-right">1 year</span>
                <span className="text-right">6 months</span>
                <span className="text-right">Assigned</span>
              </div>
              <Separator />
              {visiblePlans.map((plan) => (
                <div key={plan.id}>
                  <div
                    className={cn(
                      "grid grid-cols-[1.2fr_1.6fr_0.8fr_0.8fr_0.8fr_auto] items-center gap-3 px-1 py-3 text-sm",
                      !plan.isActive && "opacity-60"
                    )}
                  >
                    <span className="font-mono text-xs">{plan.planCode}</span>
                    <span className="min-w-0">
                      <span className="block truncate font-medium">
                        {plan.planName}
                      </span>
                      {!plan.isActive ? (
                        <span className="text-muted-foreground text-xs">
                          Retired — cannot be assigned
                        </span>
                      ) : null}
                    </span>
                    <span className="text-muted-foreground">
                      {LICENSE_PLAN_LABELS[plan.licensePlan] ?? plan.licensePlan}
                    </span>
                    <span className="text-right tabular-nums">
                      {formatMinor(plan.priceAnnuallyMinor, plan.currencyCode)}
                    </span>
                    <span className="text-right tabular-nums">
                      {formatMinor(plan.priceBiAnnuallyMinor, plan.currencyCode)}
                    </span>
                    <span className="flex items-center justify-end gap-2">
                      <span className="text-muted-foreground text-xs">
                        {plan.assignmentCount}
                      </span>
                      {canManage ? (
                        <Button
                          size="icon"
                          variant="ghost"
                          className="size-7"
                          aria-label={`Edit ${plan.planName}`}
                          onClick={() => {
                            setEditing(plan)
                            setDialogOpen(true)
                          }}
                        >
                          <Pencil className="size-3.5" />
                        </Button>
                      ) : null}
                    </span>
                  </div>
                  <Separator />
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Assignments</CardTitle>
          <CardDescription>
            An outlet-scope assignment overrides the franchise-wide one. An
            outlet imported later inherits its franchise&rsquo;s plan
            automatically.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {assignments.length === 0 ? (
            <p className="text-muted-foreground py-4 text-sm">
              Nothing assigned yet.
            </p>
          ) : (
            <div className="flex flex-col">
              {assignments.map((assignment) => (
                <div key={assignment.id}>
                  <div className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm">
                    <div className="min-w-0">
                      <span className="font-medium">
                        {assignment.plan?.planName ?? "Unknown plan"}
                      </span>
                      <span className="text-muted-foreground">
                        {" "}
                        · {scopeLabel(assignment)}
                      </span>
                      <div className="text-muted-foreground text-xs">
                        Default term: {TERM_LABELS[assignment.defaultBillingPlan]}
                        {assignment.overrideReason
                          ? ` · ${describeOverride(assignment)}`
                          : ""}
                      </div>
                    </div>
                    {assignment.approvalStatus === "pending" ? (
                      <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-900 dark:bg-amber-900/40 dark:text-amber-100">
                        Awaiting approval
                      </span>
                    ) : assignment.approvalStatus === "rejected" ? (
                      <span className="text-destructive text-xs">
                        Override rejected
                      </span>
                    ) : null}
                  </div>
                  <Separator />
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <PlanDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        plan={editing}
        onSaved={() => void load()}
      />
    </div>
  )
}

function scopeLabel(assignment: Assignment): string {
  return assignment.scope === "franchise"
    ? `Franchise ${assignment.franchiseId}, all outlets`
    : `Outlet ${assignment.franchiseId}/${assignment.outletId}`
}

/**
 * Describe an override in the direction it actually moves the price.
 *
 * Never the word "discount" unless it is one: an override may raise the
 * catalog price as readily as lower it, and Analytics reports the two
 * separately rather than netting them.
 */
function describeOverride(assignment: Assignment): string {
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
  const direction =
    assignment.overrideDirection === "increase"
      ? "Increase"
      : assignment.overrideDirection === "decrease"
        ? "Reduction"
        : "Override"
  return `${direction} · ${parts.join(", ")}`
}
