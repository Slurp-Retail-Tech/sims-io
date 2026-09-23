"use client"

import * as React from "react"
import Link from "next/link"
import { AlertTriangle, ChevronLeft, Plus, Trash2 } from "lucide-react"

import { useToast } from "@/components/toast-provider"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { cn } from "@/lib/utils"

import { AssignmentDialog, type AssignmentSaved } from "../assignment-dialog"
import { formatMinor } from "../format"
import { PlanDialog } from "../plan-dialog"
import { describeOverride, scopeLabel } from "../plan-catalog-view"
import { LICENSE_PLAN_LABELS, TERM_LABELS } from "../types"
import type { Assignment, Plan } from "../types"

type PlanDetailViewProps = {
  planId: string
  canManage: boolean
}

type LoadState = "loading" | "ready" | "not_found" | "error"

/**
 * One plan: its two term prices, who is assigned to it, and anything on this
 * plan waiting on an approval. An outlet-scope assignment overrides the
 * franchise-wide one; resolution is computed at read time, so an outlet
 * imported later inherits the franchise plan automatically.
 */
export function PlanDetailView({ planId, canManage }: PlanDetailViewProps) {
  const { showToast } = useToast()
  const [plan, setPlan] = React.useState<Plan | null>(null)
  const [assignments, setAssignments] = React.useState<Assignment[]>([])
  const [state, setState] = React.useState<LoadState>("loading")

  const [dialogOpen, setDialogOpen] = React.useState(false)
  const [assignOpen, setAssignOpen] = React.useState(false)
  const [ending, setEnding] = React.useState<string | null>(null)

  const load = React.useCallback(async () => {
    setState("loading")
    try {
      const [planResponse, assignmentsResponse] = await Promise.all([
        fetch(`/api/renewals/plans/${planId}`, { cache: "no-store" }),
        fetch(`/api/renewals/plans/assignments?planId=${planId}&includeSuperseded=false`, {
          cache: "no-store",
        }),
      ])

      if (planResponse.status === 404) {
        setState("not_found")
        return
      }
      if (!planResponse.ok) {
        throw new Error("Unable to load the plan.")
      }

      const planPayload = (await planResponse.json()) as { plan: Plan }
      setPlan(planPayload.plan)

      if (assignmentsResponse.ok) {
        const payload = (await assignmentsResponse.json()) as { assignments: Assignment[] }
        setAssignments(payload.assignments ?? [])
      }

      setState("ready")
    } catch {
      setState("error")
    }
  }, [planId])

  React.useEffect(() => {
    void load()
  }, [load])

  async function endAssignment(assignment: Assignment) {
    const label = scopeLabel(assignment)
    if (!window.confirm(`End the ${assignment.plan?.planName ?? "plan"} assignment for ${label}?`)) {
      return
    }
    setEnding(assignment.id)
    try {
      const response = await fetch(`/api/renewals/plans/assignments/${assignment.id}`, {
        method: "DELETE",
      })
      if (!response.ok) {
        showToast("Unable to end the assignment.", "error")
        return
      }
      showToast("Assignment ended.", "success")
      void load()
    } catch {
      showToast("Unable to reach the server. Try again.", "error")
    } finally {
      setEnding(null)
    }
  }

  function handleAssigned(result: AssignmentSaved) {
    const replaced = result.supersededAssignmentId
      ? " It replaces the previous assignment at this scope."
      : ""
    if (result.approvalStatus === "pending") {
      showToast(
        `Assigned, but the agreed price waits for approval before it prices anything.${replaced}`,
        "success"
      )
    } else {
      showToast(`Plan assigned.${replaced}`, "success")
    }
    void load()
  }

  if (state === "loading") {
    return <p className="text-muted-foreground text-sm">Loading plan…</p>
  }

  if (state === "not_found" || state === "error") {
    return (
      <div className="flex flex-col items-start gap-3">
        <p className="text-destructive text-sm">
          {state === "not_found" ? "Plan not found." : "Unable to load the plan."}
        </p>
        <Button variant="outline" size="sm" asChild>
          <Link href="/renewal-retention/plans">Back to plan catalog</Link>
        </Button>
      </div>
    )
  }

  if (!plan) {
    return null
  }

  const pendingAssignments = assignments.filter((a) => a.approvalStatus === "pending")
  const pendingCount = pendingAssignments.length

  return (
    <div className="animate-in fade-in slide-in-from-bottom-2 flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Button variant="outline" size="sm" asChild>
          <Link href="/renewal-retention/plans">
            <ChevronLeft className="size-4" />
            Back to plan catalog
          </Link>
        </Button>
        {canManage ? (
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={() => setDialogOpen(true)}>
              Edit plan
            </Button>
            <Button size="sm" disabled={!plan.isActive} onClick={() => setAssignOpen(true)}>
              Assign plan
            </Button>
          </div>
        ) : null}
      </div>

      <div>
        <div className="flex flex-wrap items-center gap-2.5">
          <h1 className="text-2xl font-semibold tracking-tight">{plan.planName}</h1>
          <span
            className={cn(
              "rounded-full px-2.5 py-0.5 text-[11px] font-semibold",
              plan.isActive
                ? "bg-emerald-500/15 text-emerald-800 dark:text-emerald-200"
                : "bg-muted-foreground/10 text-muted-foreground"
            )}
          >
            {plan.isActive ? "Active" : "Retired"}
          </span>
          <span className="text-muted-foreground rounded-full border px-2.5 py-0.5 font-mono text-[11px]">
            {plan.planCode}
          </span>
        </div>
        <p className="text-muted-foreground mt-1.5 text-sm">
          {plan.description ? `${plan.description} · ` : ""}
          {LICENSE_PLAN_LABELS[plan.licensePlan] ?? plan.licensePlan} tier · Updated{" "}
          {formatUpdatedDate(plan.updatedAt)}
        </p>
      </div>

      <div className="grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(min(100%,190px),1fr))]">
        <StatTile
          label="Annual price"
          value={formatMinor(plan.priceAnnuallyMinor, plan.currencyCode)}
          note="Offered as the 1-year term."
        />
        <StatTile
          label="Bi-annual price"
          value={
            plan.priceBiAnnuallyMinor === null
              ? "Not priced"
              : formatMinor(plan.priceBiAnnuallyMinor, plan.currencyCode)
          }
          valueTone={plan.priceBiAnnuallyMinor === null ? "amber" : undefined}
          note={
            plan.priceBiAnnuallyMinor === null
              ? "Only the annual term is offered on the renewal page."
              : `Equivalent to ${formatMinor(plan.priceBiAnnuallyMinor * 2, plan.currencyCode)} a year.`
          }
        />
        <StatTile
          label="Assignments"
          value={String(assignments.length)}
          note="Resolving from the rows below."
        />
        <StatTile
          label="Pending approval"
          value={pendingCount === 0 ? "None" : String(pendingCount)}
          valueTone={pendingCount > 0 ? "red" : undefined}
          note="Agreed prices past the variance threshold."
        />
      </div>

      {pendingCount > 0 ? (
        <div className="flex items-start gap-2.5 rounded-[var(--radius)] border border-red-800/30 bg-red-800/[0.06] px-3.5 py-3">
          <AlertTriangle className="text-destructive mt-0.5 size-4 shrink-0" />
          <span className="text-destructive text-[0.8125rem]">
            {pendingCount} {pendingCount === 1 ? "agreed price on this plan is" : "agreed prices on this plan are"} past
            the threshold and blocking invoicing until approved.
          </span>
        </div>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Assignments</CardTitle>
          <CardDescription>
            An outlet-scope assignment wins over a franchise-scope one. Resolution is computed
            at read time, so outlets imported later inherit the franchise plan.
          </CardDescription>
          {canManage ? (
            <CardAction>
              <Button
                variant="outline"
                size="sm"
                disabled={!plan.isActive}
                title={plan.isActive ? undefined : "Retired plans cannot take new assignments"}
                onClick={() => setAssignOpen(true)}
              >
                <Plus className="size-4" />
                New assignment
              </Button>
            </CardAction>
          ) : null}
        </CardHeader>
        <CardContent>
          {assignments.length === 0 ? (
            <p className="text-muted-foreground py-4 text-sm">
              {canManage
                ? "Nothing assigned yet. Until a franchise or outlet is on this plan, its renewals land in Actions Required instead of being invoiced."
                : "Nothing assigned yet."}
            </p>
          ) : (
            <div className="flex flex-col">
              <div className="text-muted-foreground grid grid-cols-[minmax(0,1fr)_8rem_9rem] gap-3 border-b px-1 pb-2.5 text-[11px] tracking-[0.05em] uppercase">
                <span>Scope</span>
                <span className="text-right">Effective price</span>
                <span className="text-right">Approval</span>
              </div>
              {assignments.map((assignment) => (
                <div
                  key={assignment.id}
                  className="grid grid-cols-[minmax(0,1fr)_8rem_9rem] items-center gap-3 border-b px-1 py-3 text-sm"
                >
                  <span className="flex min-w-0 flex-col gap-0.5">
                    <span>{scopeLabel(assignment)}</span>
                    <span className="text-muted-foreground text-xs">
                      Default term: {TERM_LABELS[assignment.defaultBillingPlan]}
                    </span>
                    <span
                      className={cn(
                        "text-xs",
                        assignment.overrideReason ? "text-amber-700 dark:text-amber-400" : "text-muted-foreground"
                      )}
                    >
                      {describeOverride(assignment)}
                      {assignment.overrideReason ? ` · ${assignment.overrideReason}` : ""}
                    </span>
                  </span>
                  <span className="text-right font-medium tabular-nums whitespace-nowrap">
                    {formatMinor(
                      assignment.defaultBillingPlan === "annually"
                        ? (assignment.overridePriceAnnuallyMinor ?? assignment.plan?.priceAnnuallyMinor ?? null)
                        : (assignment.overridePriceBiAnnuallyMinor ?? assignment.plan?.priceBiAnnuallyMinor ?? null)
                    )}
                  </span>
                  <span className="flex items-center justify-end gap-2">
                    <span
                      className={cn(
                        "rounded-full px-2 py-0.5 text-[11px] font-medium whitespace-nowrap",
                        assignment.approvalStatus === "pending" || assignment.approvalStatus === "rejected"
                          ? "bg-red-500/10 text-red-800 dark:text-red-200"
                          : "bg-emerald-500/15 text-emerald-800 dark:text-emerald-200"
                      )}
                    >
                      {assignment.approvalStatus === "pending"
                        ? "Pending approval"
                        : assignment.approvalStatus === "rejected"
                          ? "Rejected"
                          : assignment.approvalStatus === "approved"
                            ? "Approved"
                            : "Active"}
                    </span>
                    {canManage ? (
                      <Button
                        size="icon"
                        variant="ghost"
                        className="text-muted-foreground hover:text-destructive size-7"
                        disabled={ending === assignment.id}
                        aria-label={`End assignment for ${scopeLabel(assignment)}`}
                        onClick={() => void endAssignment(assignment)}
                      >
                        <Trash2 className="size-3.5" />
                      </Button>
                    ) : null}
                  </span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <PlanDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        plan={plan}
        onSaved={() => {
          showToast("Plan updated.", "success")
          void load()
        }}
      />

      <AssignmentDialog
        open={assignOpen}
        onOpenChange={setAssignOpen}
        plans={plan.isActive ? [plan] : []}
        initialPlanId={plan.id}
        onSaved={handleAssigned}
      />
    </div>
  )
}

function StatTile({
  label,
  value,
  note,
  valueTone,
}: {
  label: string
  value: string
  note: string
  valueTone?: "amber" | "red"
}) {
  return (
    <div className="bg-card rounded-[var(--radius)] border px-4 py-3.5">
      <div className="text-muted-foreground text-xs">{label}</div>
      <div
        className={cn(
          "mt-1 text-lg font-semibold tabular-nums",
          valueTone === "amber" && "text-amber-700 dark:text-amber-400",
          valueTone === "red" && "text-destructive"
        )}
      >
        {value}
      </div>
      <div className="text-muted-foreground mt-0.5 text-xs">{note}</div>
    </div>
  )
}

function formatUpdatedDate(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value)
  if (!match) {
    return value
  }
  const months = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
  ]
  return `${Number(match[3])} ${months[Number(match[2]) - 1] ?? match[2]} ${match[1]}`
}
