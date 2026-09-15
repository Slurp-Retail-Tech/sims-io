"use client"

import * as React from "react"
import { AlertTriangle, CheckCircle2, Info } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Separator } from "@/components/ui/separator"
import { useToast } from "@/components/toast-provider"
import { cn } from "@/lib/utils"

import { REASON_FIXES, REASON_LABELS } from "./reasons"

type ActionRow = {
  id: string
  franchiseId: string
  outletId: string | null
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

/**
 * The queue of everything stopping a renewal being carried through.
 *
 * Sorted with blocking entries first and then by days remaining, because the
 * queue's whole purpose is to be worked before a licence lapses — age is the
 * wrong axis when one entry has fourteen days left and another has one.
 *
 * Entries resolve themselves. Nothing here needs ticking off once the
 * underlying gap is closed; dismissal exists only for an entry that is
 * genuinely not a problem, and it asks why.
 */
export function ActionsRequiredView({ canManage }: { canManage: boolean }) {
  const { showToast } = useToast()
  const [actions, setActions] = React.useState<ActionRow[]>([])
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [dismissing, setDismissing] = React.useState<string | null>(null)

  const load = React.useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const response = await fetch("/api/renewals/actions-required", {
        cache: "no-store",
      })
      if (!response.ok) {
        throw new Error("Unable to load the queue.")
      }
      const payload = (await response.json()) as { actions: ActionRow[] }
      setActions(payload.actions ?? [])
    } catch (loadError) {
      setError(
        loadError instanceof Error ? loadError.message : "Unable to load the queue."
      )
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
      const response = await fetch(
        `/api/renewals/actions-required/${action.id}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ reason: reason.trim() }),
        }
      )
      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as {
          error?: string
        }
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
  const informational = actions.filter(
    (action) => action.severity === "informational"
  )

  return (
    <div className="animate-in fade-in slide-in-from-bottom-2 flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          Actions Required
        </h1>
        <p className="text-muted-foreground text-sm">
          Everything stopping a renewal being invoiced or sent. Fix the
          underlying gap and the entry clears itself on the next nightly run.
        </p>
      </div>

      {loading ? (
        <p className="text-muted-foreground text-sm">Loading the queue…</p>
      ) : error ? (
        <div>
          <p className="text-destructive text-sm">{error}</p>
          <Button size="sm" variant="outline" className="mt-3" onClick={() => void load()}>
            Try again
          </Button>
        </div>
      ) : actions.length === 0 ? (
        <Card>
          <CardContent className="flex items-center gap-3 py-10">
            <CheckCircle2 className="size-5 text-emerald-600" />
            <div>
              <p className="text-sm font-medium">Nothing is blocked.</p>
              <p className="text-muted-foreground text-sm">
                Every subscription coming up for renewal has a plan, a price and
                someone accountable for it.
              </p>
            </div>
          </CardContent>
        </Card>
      ) : (
        <>
          {blocking.length > 0 ? (
            <QueueCard
              title={`${blocking.length} blocking ${blocking.length === 1 ? "issue" : "issues"}`}
              description="These outlets are not being invoiced until the gap is closed."
              tone="blocking"
              actions={blocking}
              canManage={canManage}
              dismissing={dismissing}
              onDismiss={dismiss}
            />
          ) : null}

          {informational.length > 0 ? (
            <QueueCard
              title={`${informational.length} for information`}
              description="Recorded, but the renewal proceeded."
              tone="informational"
              actions={informational}
              canManage={canManage}
              dismissing={dismissing}
              onDismiss={dismiss}
            />
          ) : null}
        </>
      )}
    </div>
  )
}

function QueueCard({
  title,
  description,
  tone,
  actions,
  canManage,
  dismissing,
  onDismiss,
}: {
  title: string
  description: string
  tone: "blocking" | "informational"
  actions: ActionRow[]
  canManage: boolean
  dismissing: string | null
  onDismiss: (action: ActionRow) => void
}) {
  const Icon = tone === "blocking" ? AlertTriangle : Info

  return (
    <Card className={cn(tone === "blocking" && "border-amber-300")}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Icon
            className={cn(
              "size-4",
              tone === "blocking" ? "text-amber-600" : "text-muted-foreground"
            )}
          />
          {title}
        </CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col">
        {actions.map((action) => (
          <div key={action.id}>
            <div className="flex flex-wrap items-start justify-between gap-3 py-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium">
                    {REASON_LABELS[action.reason] ?? action.reason}
                  </span>
                  <span className="text-muted-foreground text-xs">
                    {scopeLabel(action)}
                  </span>
                  <DaysBadge days={action.daysToExpiry} />
                </div>
                <p className="text-muted-foreground mt-1 text-xs">
                  {REASON_FIXES[action.reason] ?? action.detail ?? ""}
                </p>
                {action.occurrenceCount > 1 ? (
                  <p className="text-muted-foreground mt-1 text-xs">
                    Seen on {action.occurrenceCount} nightly runs.
                  </p>
                ) : null}
              </div>
              {canManage ? (
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={dismissing === action.id}
                  onClick={() => onDismiss(action)}
                >
                  {dismissing === action.id ? "Dismissing…" : "Dismiss"}
                </Button>
              ) : null}
            </div>
            <Separator />
          </div>
        ))}
      </CardContent>
    </Card>
  )
}

/**
 * Days remaining, coloured by urgency.
 *
 * A negative number means the licence has already lapsed, which reads very
 * differently from "due in 14 days" and must not look the same.
 */
function DaysBadge({ days }: { days: number | null }) {
  if (days === null) {
    return null
  }

  const lapsed = days < 0
  const urgent = days >= 0 && days <= 5

  return (
    <span
      className={cn(
        "rounded-full px-2 py-0.5 text-xs",
        lapsed
          ? "bg-destructive/10 text-destructive"
          : urgent
            ? "bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-100"
            : "text-muted-foreground bg-muted"
      )}
    >
      {lapsed
        ? `Expired ${Math.abs(days)}d ago`
        : days === 0
          ? "Expires today"
          : `${days}d left`}
    </span>
  )
}

function scopeLabel(action: ActionRow): string {
  return action.outletId
    ? `Outlet ${action.franchiseId}/${action.outletId}`
    : `Franchise ${action.franchiseId}`
}
