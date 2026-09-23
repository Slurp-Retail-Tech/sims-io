"use client"

import * as React from "react"
import Link from "next/link"
import { AlertTriangle, CheckCircle2, Clock, Inbox, RefreshCw } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { useToast } from "@/components/toast-provider"
import { cn } from "@/lib/utils"

import { daysLabel, PageHeader, Pill, PillTabs, RunStatusLine, TONE_TEXT } from "../ui"
import type { RunStatus, Tone } from "../ui"
import { REASON_FIXES, REASON_LABELS } from "./reasons"

type ActionRow = {
  id: string
  franchiseId: string
  outletId: string | null
  franchiseName: string | null
  outletName: string | null
  centralId: string | null
  invoiceId: string | null
  reason: string
  detail: string | null
  severity: "blocking" | "informational"
  daysToExpiry: number | null
  occurrenceCount: number
  firstDetectedAt: string
  lastDetectedAt: string
}

type Tab = "all" | "blocking" | "informational"

type QueueState = "never_checked" | "last_run_failed" | "nothing_in_window" | "clear" | "has_entries"

/**
 * What an empty queue says, by what it actually knows. Decided server-side in
 * `src/lib/renewal/queue-state.ts`; an empty queue only claims "clear" once a
 * check has succeeded and had something to examine.
 */
function emptyQueueCopy(state: QueueState, status: RunStatus | null): {
  icon: React.ReactNode
  title: string
  body: string
} {
  const days = status?.readinessWindowDays ?? 30
  switch (state) {
    case "never_checked":
      return {
        icon: <Clock className="text-muted-foreground size-5" />,
        title: "Nothing has been checked yet.",
        body: `The nightly check examines every subscription expiring in the next ${days} days for a plan, a price and a reachable renewal PIC. Anything missing appears here after it first runs.`,
      }
    case "last_run_failed":
      return {
        icon: <AlertTriangle className="size-5 text-amber-600" />,
        title: "The last check did not complete.",
        body: "An empty queue says nothing about today until the next check succeeds.",
      }
    case "nothing_in_window":
      return {
        icon: <Inbox className="text-muted-foreground size-5" />,
        title: `No subscriptions expire in the next ${days} days.`,
        body: "There is nothing for the check to examine yet.",
      }
    default:
      return {
        icon: <CheckCircle2 className="size-5 text-emerald-600" />,
        title: "Nothing is blocked.",
        body: `Every subscription expiring in the next ${days} days has a plan, a price and someone accountable for it.`,
      }
  }
}

/** Where the fix lives, per reason. The button takes the person there. */
function fixLink(action: ActionRow): { label: string; href: string } | null {
  const contactsHref = `/contacts?fid=${encodeURIComponent(action.franchiseId)}`
  switch (action.reason) {
    case "no_plan_assigned":
    case "plan_missing_term_price":
      return { label: "Assign a plan", href: "/renewal-retention/plans" }
    case "override_pending_approval":
      return { label: "Review agreed price", href: "/renewal-retention/plans" }
    case "override_rejected":
      return { label: "Reassign plan", href: "/renewal-retention/plans" }
    case "no_renewal_pic":
      return { label: "Set renewal PIC", href: contactsHref }
    case "ambiguous_renewal_pic":
      return { label: "Set franchise PIC", href: contactsHref }
    case "unreachable_renewal_pic":
    case "channel_unreachable":
      return { label: "Fix contact", href: contactsHref }
    case "missing_valid_until":
      return { label: "Open renewal list", href: `/renewal-retention/renewal-due?fid=${encodeURIComponent(action.franchiseId)}` }
    default:
      return action.invoiceId
        ? { label: "Open invoice", href: `/renewal-retention/invoices/${action.invoiceId}` }
        : null
  }
}

/**
 * The queue of everything stopping a renewal being carried through.
 *
 * Built to the design: one card per entry with the reason in mono, a
 * blocking/informational pill, the place it concerns, the detail, how urgent
 * it is and how long it has persisted, and a button that goes to the fix.
 *
 * Entries resolve themselves once the gap is closed. Dismissal is for an entry
 * that is genuinely not a problem, and it asks why.
 */
export function ActionsRequiredView({
  canManage,
  canCheckNow,
  canAcceptPosDate,
}: {
  canManage: boolean
  /** Subscriptions manage key: may take the POS expiry for a drift entry. */
  canAcceptPosDate: boolean
  /** Admins with the invoices key may run the eligibility checks on demand. */
  canCheckNow: boolean
}) {
  const { showToast } = useToast()
  const [actions, setActions] = React.useState<ActionRow[]>([])
  const [runStatus, setRunStatus] = React.useState<RunStatus | null>(null)
  const [queueState, setQueueState] = React.useState<QueueState>("has_entries")
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [dismissing, setDismissing] = React.useState<string | null>(null)
  const [tab, setTab] = React.useState<Tab>("all")
  const [checking, setChecking] = React.useState(false)

  const load = React.useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const response = await fetch("/api/renewals/actions-required", { cache: "no-store" })
      if (!response.ok) {
        throw new Error("Unable to load the queue.")
      }
      const payload = (await response.json()) as {
        actions: ActionRow[]
        runStatus?: RunStatus
        queueState?: QueueState
      }
      setActions(payload.actions ?? [])
      setRunStatus(payload.runStatus ?? null)
      setQueueState(payload.queueState ?? "has_entries")
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Unable to load the queue.")
    } finally {
      setLoading(false)
    }
  }, [])

  React.useEffect(() => {
    void load()
  }, [load])

  // Runs the nightly check's eligibility pass now. It never raises an invoice,
  // so a person can confirm a fix without billing anyone early.
  async function checkNow() {
    setChecking(true)
    try {
      const response = await fetch("/api/renewals/cycle", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "check" }),
      })
      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as { error?: string }
        showToast(payload.error ?? "The check could not run.", "error")
        return
      }
      showToast("Checked. The queue below is current. No invoices were raised.", "success")
      await load()
    } catch {
      showToast("Unable to reach the server. Try again.", "error")
    } finally {
      setChecking(false)
    }
  }

  // Takes the POS expiry as the SIMS expiry. Forward only; the server
  // refuses if the POS is no longer ahead.
  async function acceptPosDate(action: ActionRow) {
    const confirmed = window.confirm(
      `Take the POS expiry date as the SIMS date for ${scopeLabel(action)}?\n\nDo this only if the outlet really was renewed outside SIMS. Any open proforma for the old date will then be reported as stale.`
    )
    if (!confirmed) {
      return
    }
    setDismissing(action.id)
    try {
      const response = await fetch(`/api/renewals/actions-required/${action.id}/accept-pos-date`, { method: "POST" })
      const payload = (await response.json().catch(() => ({}))) as { error?: string; validUntil?: string }
      if (!response.ok) {
        showToast(payload.error ?? "Unable to accept the POS date.", "error")
        return
      }
      showToast(`Expiry set to ${payload.validUntil?.slice(0, 10) ?? "the POS date"}.`, "success")
      void load()
    } catch {
      showToast("Unable to reach the server. Try again.", "error")
    } finally {
      setDismissing(null)
    }
  }

  async function dismiss(action: ActionRow) {
    const reason = window.prompt(
      `Dismissing "${REASON_LABELS[action.reason] ?? action.reason}" for ${scopeLabel(action)}.\n\nWhy is this not a problem?`
    )
    if (!reason?.trim()) {
      return
    }
    setDismissing(action.id)
    try {
      const response = await fetch(`/api/renewals/actions-required/${action.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: reason.trim() }),
      })
      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as { error?: string }
        showToast(payload.error ?? "Unable to dismiss the entry.", "error")
        return
      }
      showToast("Entry dismissed.", "success")
      void load()
    } catch {
      showToast("Unable to reach the server. Try again.", "error")
    } finally {
      setDismissing(null)
    }
  }

  const blocking = actions.filter((action) => action.severity === "blocking")
  const informational = actions.filter((action) => action.severity === "informational")
  const visible = tab === "all" ? actions : tab === "blocking" ? blocking : informational

  return (
    <div className="animate-in fade-in slide-in-from-bottom-2 flex flex-col gap-5">
      <PageHeader
        title="Actions Required"
        description="Outlets and franchises that cannot be carried through the renewal flow, with the reason. Entries auto-resolve on the next nightly run once the gap is closed."
        meta={<RunStatusLine status={runStatus} />}
      >
        {canCheckNow ? (
          <Button
            variant="outline"
            size="sm"
            disabled={checking}
            onClick={() => void checkNow()}
            title="Re-runs the plan, price and PIC checks now. Never raises an invoice."
          >
            <RefreshCw className={cn("size-3.5", checking && "animate-spin")} />
            {checking ? "Checking…" : "Check now"}
          </Button>
        ) : null}
        <PillTabs
          size="sm"
          value={tab}
          onChange={setTab}
          tabs={[
            { key: "all", label: `All ${actions.length}` },
            { key: "blocking", label: `Blocking ${blocking.length}` },
            { key: "informational", label: `Informational ${informational.length}` },
          ]}
        />
      </PageHeader>

      {loading ? (
        <p className="text-muted-foreground text-sm">Loading the queue…</p>
      ) : error ? (
        <div>
          <p className="text-destructive text-sm">{error}</p>
          <Button size="sm" variant="outline" className="mt-3" onClick={() => void load()}>
            Try again
          </Button>
        </div>
      ) : visible.length === 0 ? (
        <Card>
          <CardContent className="flex items-center gap-3 py-10">
            {actions.length === 0 ? (
              (() => {
                const copy = emptyQueueCopy(queueState, runStatus)
                return (
                  <>
                    {copy.icon}
                    <div>
                      <p className="text-sm font-medium">{copy.title}</p>
                      <p className="text-muted-foreground text-sm text-pretty">{copy.body}</p>
                    </div>
                  </>
                )
              })()
            ) : (
              <>
                <CheckCircle2 className="size-5 text-emerald-600" />
                <div>
                  <p className="text-sm font-medium">Nothing in this tab.</p>
                  <p className="text-muted-foreground text-sm">Switch tabs to see the rest of the queue.</p>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      ) : (
        <div className="flex flex-col gap-3">
          {visible.map((action) => {
            const isBlocking = action.severity === "blocking"
            const accent: Tone = isBlocking ? "red" : "gray"
            const urgency = daysLabel(action.daysToExpiry)
            const fix = fixLink(action)
            return (
              <div
                key={action.id}
                className={cn(
                  "bg-card flex flex-wrap items-start gap-4 rounded-[calc(var(--radius)+2px)] border border-l-[3px] px-5 py-4",
                  isBlocking ? "border-red-500/30 border-l-red-600" : "border-l-muted-foreground/40"
                )}
              >
                <div className="flex min-w-0 flex-1 basis-[22rem] flex-col gap-1.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={cn("text-sm font-semibold", TONE_TEXT[accent])} title={action.reason}>
                      {REASON_LABELS[action.reason] ?? action.reason}
                    </span>
                    <Pill tone={isBlocking ? "red" : "gray"} className="font-medium">
                      {isBlocking ? "Blocks invoicing" : "Informational"}
                    </Pill>
                  </div>
                  <span className="text-[0.9375rem] font-medium">{scopeLabel(action)}</span>
                  <span className="text-muted-foreground text-[0.8125rem] text-pretty">
                    {action.detail ?? REASON_FIXES[action.reason] ?? REASON_LABELS[action.reason] ?? ""}
                    {action.outletId ? ` OID ${action.outletId}${action.centralId ? ` · ${action.centralId}` : ""}.` : ""}
                  </span>
                </div>
                <div className="flex min-w-[9rem] shrink-0 flex-col gap-0.5">
                  <span className={cn("text-[0.8125rem]", TONE_TEXT[urgency.tone])}>{urgency.label}</span>
                  <span className="text-muted-foreground text-xs">
                    Detected {action.firstDetectedAt.slice(0, 10)} ·{" "}
                    {action.occurrenceCount === 1 ? "1 run" : `${action.occurrenceCount} runs`}
                  </span>
                </div>
                <div className="flex shrink-0 gap-2">
                  {fix ? (
                    <Button variant="outline" size="sm" asChild>
                      <Link href={fix.href}>{fix.label}</Link>
                    </Button>
                  ) : null}
                  {canAcceptPosDate && action.reason === "pos_valid_until_drift" && action.outletId ? (
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={dismissing === action.id}
                      onClick={() => void acceptPosDate(action)}
                    >
                      Accept POS date
                    </Button>
                  ) : null}
                  {canManage ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-muted-foreground"
                      disabled={dismissing === action.id}
                      onClick={() => void dismiss(action)}
                    >
                      {dismissing === action.id ? "Dismissing…" : "Dismiss"}
                    </Button>
                  ) : null}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

function scopeLabel(action: ActionRow): string {
  const franchise = action.franchiseName ?? `Franchise ${action.franchiseId}`
  if (!action.outletId) {
    return `${franchise} · grouped invoice`
  }
  return `${franchise} · ${action.outletName ?? `Outlet ${action.outletId}`}`
}
