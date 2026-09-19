"use client"

import * as React from "react"
import Link from "next/link"
import { CheckCircle2 } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { useToast } from "@/components/toast-provider"
import { cn } from "@/lib/utils"

import { daysLabel, PageHeader, Pill, PillTabs, TONE_TEXT } from "../ui"
import type { Tone } from "../ui"
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

/** Where the fix lives, per reason. The button takes the person there. */
function fixLink(action: ActionRow): { label: string; href: string } | null {
  const contactsHref = `/contacts?fid=${encodeURIComponent(action.franchiseId)}`
  switch (action.reason) {
    case "no_plan_assigned":
    case "plan_missing_term_price":
      return { label: "Assign a plan", href: "/renewal-retention/plans" }
    case "override_pending_approval":
      return { label: "Review override", href: "/renewal-retention/plans" }
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
export function ActionsRequiredView({ canManage }: { canManage: boolean }) {
  const { showToast } = useToast()
  const [actions, setActions] = React.useState<ActionRow[]>([])
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [dismissing, setDismissing] = React.useState<string | null>(null)
  const [tab, setTab] = React.useState<Tab>("all")

  const load = React.useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const response = await fetch("/api/renewals/actions-required", { cache: "no-store" })
      if (!response.ok) {
        throw new Error("Unable to load the queue.")
      }
      const payload = (await response.json()) as { actions: ActionRow[] }
      setActions(payload.actions ?? [])
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Unable to load the queue.")
    } finally {
      setLoading(false)
    }
  }, [])

  React.useEffect(() => {
    void load()
  }, [load])

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
      >
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
            <CheckCircle2 className="size-5 text-emerald-600" />
            <div>
              <p className="text-sm font-medium">
                {actions.length === 0 ? "Nothing is blocked." : "Nothing in this tab."}
              </p>
              <p className="text-muted-foreground text-sm">
                {actions.length === 0
                  ? "Every subscription inside the readiness window has a plan, a price and someone accountable for it."
                  : "Switch tabs to see the rest of the queue."}
              </p>
            </div>
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
                    <span className={cn("font-mono text-xs font-semibold", TONE_TEXT[accent])}>
                      {action.reason}
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
