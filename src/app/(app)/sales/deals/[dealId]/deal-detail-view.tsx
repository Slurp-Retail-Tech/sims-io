"use client"

import * as React from "react"
import Link from "next/link"
import { ChevronLeft } from "lucide-react"

import { cn } from "@/lib/utils"
import { formatDate, formatDateTime } from "@/lib/dates"
import { formatCurrency } from "@/lib/currency"
import { useSetBreadcrumbLabel } from "@/components/breadcrumb-context"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  isTerminalStage,
  type DealStage,
  type MappedGlobalDeal,
} from "@/lib/deals"
import type { DealTimelineEntry, MappedDealActivity } from "@/lib/deal-activities"
import type { MappedActivity } from "@/lib/lead-activities"

const STAGE_BADGE_CLASS: Record<DealStage, string> = {
  "To Qualify": "bg-muted text-muted-foreground",
  "Demo Scheduled": "bg-blue-500/10 text-blue-600 dark:text-blue-400",
  "Quotation Sent": "bg-amber-500/10 text-amber-600 dark:text-amber-400",
  "Closed Won": "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  "Closed Lost": "bg-red-500/10 text-red-600 dark:text-red-400",
}

function StageBadge({ stage }: { stage: DealStage }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium",
        STAGE_BADGE_CLASS[stage]
      )}
    >
      {stage}
    </span>
  )
}

export function DealDetailView({ dealId }: { dealId: string }) {
  const [deal, setDeal] = React.useState<MappedGlobalDeal | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)

  const [activities, setActivities] = React.useState<DealTimelineEntry[]>([])
  const [activitiesLoading, setActivitiesLoading] = React.useState(true)

  useSetBreadcrumbLabel(`/sales/deals/${dealId}`, deal?.dealName ?? null)

  const loadDeal = React.useCallback(async () => {
    setLoading(true)
    setError(null)
    setDeal(null)
    try {
      const response = await fetch(`/api/deals/${dealId}`)
      if (response.status === 404) {
        throw new Error("Deal not found.")
      }
      if (!response.ok) {
        throw new Error("Unable to load deal.")
      }
      const data = (await response.json()) as { deal: MappedGlobalDeal }
      setDeal(data.deal)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load deal.")
      setDeal(null)
    } finally {
      setLoading(false)
    }
  }, [dealId])

  const loadActivities = React.useCallback(async () => {
    setActivitiesLoading(true)
    try {
      const response = await fetch(`/api/deals/${dealId}/activities`)
      if (!response.ok) {
        throw new Error("Unable to load activity.")
      }
      const data = (await response.json()) as { activities: DealTimelineEntry[] }
      setActivities(data.activities ?? [])
    } catch {
      setActivities([])
    } finally {
      setActivitiesLoading(false)
    }
  }, [dealId])

  React.useEffect(() => {
    void loadDeal()
    void loadActivities()
  }, [loadDeal, loadActivities])

  if (loading) {
    return <div className="text-muted-foreground text-sm">Loading deal...</div>
  }

  if (error || !deal) {
    return (
      <div className="flex flex-col gap-4">
        <div className="text-sm text-red-600">{error ?? "Deal not found."}</div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={() => void loadDeal()}>
            Retry
          </Button>
          <Button size="sm" variant="ghost" asChild>
            <Link href="/sales/deals">Back to deals</Link>
          </Button>
        </div>
      </div>
    )
  }

  const showClosedDate = isTerminalStage(deal.dealStage) && deal.closedDate

  return (
    <div className="animate-in fade-in slide-in-from-bottom-2 flex flex-col gap-6">
      <div className="flex flex-col gap-3">
        <Button asChild variant="outline" size="sm" className="self-start">
          <Link href="/sales/deals">
            <ChevronLeft className="size-4" />
            Back to deals
          </Link>
        </Button>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">{deal.dealName}</h1>
          <StageBadge stage={deal.dealStage} />
        </div>
        <p className="text-muted-foreground text-sm">Deal #{deal.id}</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Deal details</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-1 gap-4 text-sm sm:grid-cols-2">
            <div className="flex flex-col gap-1">
              <dt className="text-muted-foreground text-xs uppercase tracking-wide">
                Contact / Lead
              </dt>
              <dd>
                <Link
                  href={`/sales/leads/${deal.leadId}`}
                  className="font-medium hover:underline"
                >
                  {deal.leadName}
                </Link>
              </dd>
            </div>
            <DetailRow label="Date created" value={formatDateTime(deal.createdAt)} />
            <DetailRow label="Amount" value={formatCurrency(deal.amount)} />
            <div className="flex flex-col gap-1">
              <dt className="text-muted-foreground text-xs uppercase tracking-wide">Stage</dt>
              <dd>
                <StageBadge stage={deal.dealStage} />
              </dd>
            </div>
            {showClosedDate ? (
              <DetailRow label="Closed date" value={formatDate(deal.closedDate!)} />
            ) : null}
            {deal.closeLostReason ? (
              <DetailRow label="Close lost reason" value={deal.closeLostReason} />
            ) : null}
            <DetailRow label="Assigned to" value={deal.assignedUserName ?? "Unassigned"} />
            {deal.closeLostRemarks ? (
              <div className="flex flex-col gap-1 sm:col-span-2">
                <dt className="text-muted-foreground text-xs uppercase tracking-wide">
                  Close lost remarks
                </dt>
                <dd className="whitespace-pre-wrap">{deal.closeLostRemarks}</dd>
              </div>
            ) : null}
          </dl>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
          <CardTitle className="text-base">Lead</CardTitle>
          <Button size="sm" variant="outline" asChild>
            <Link href={`/sales/leads/${deal.leadId}`}>View lead</Link>
          </Button>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-1 gap-4 text-sm sm:grid-cols-2">
            <div className="flex flex-col gap-1">
              <dt className="text-muted-foreground text-xs uppercase tracking-wide">Name</dt>
              <dd>
                <Link
                  href={`/sales/leads/${deal.leadId}`}
                  className="font-medium hover:underline"
                >
                  {deal.leadName}
                </Link>
              </dd>
            </div>
            <DetailRow label="Telephone" value={deal.leadTelephone} />
            <DetailRow label="Email" value={deal.leadEmail ?? "--"} />
            <DetailRow label="Business name" value={deal.leadBusinessName ?? "--"} />
            <DetailRow label="Business type" value={deal.leadBusinessType} />
            <DetailRow label="Business location" value={deal.leadBusinessLocation} />
          </dl>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Activity log</CardTitle>
        </CardHeader>
        <CardContent>
          {activitiesLoading ? (
            <div className="text-muted-foreground text-sm">Loading activity...</div>
          ) : activities.length ? (
            <ul className="flex flex-col gap-4">
              {activities.map((entry) => (
                <li key={`${entry.kind}-${entry.id}`} className="flex gap-3 text-sm">
                  <span
                    className={cn(
                      "mt-1.5 size-2 shrink-0 rounded-full",
                      entry.kind === "deal" ? "bg-primary/60" : "bg-blue-500/60"
                    )}
                  />
                  {entry.kind === "deal" ? (
                    <DealActivityItem activity={entry.activity} />
                  ) : (
                    <LeadActivityItem activity={entry.activity} />
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <div className="text-muted-foreground text-sm">No activity recorded yet.</div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1">
      <dt className="text-muted-foreground text-xs uppercase tracking-wide">{label}</dt>
      <dd>{value}</dd>
    </div>
  )
}

function DealActivityItem({ activity }: { activity: MappedDealActivity }) {
  return (
    <div className="flex flex-col gap-0.5">
      <ActivityDescription activity={activity} />
      <span className="text-muted-foreground text-xs">
        {formatDateTime(activity.createdAt)}
        {activity.createdByName ? ` · ${activity.createdByName}` : null}
      </span>
    </div>
  )
}

function ActivityDescription({ activity }: { activity: MappedDealActivity }) {
  if (activity.activityType === "created") {
    return (
      <span>
        Deal created
        {activity.toStage ? (
          <>
            {" "}
            in <span className="font-medium">{activity.toStage}</span>
          </>
        ) : null}
      </span>
    )
  }
  return (
    <span>
      Stage changed
      {activity.fromStage ? (
        <>
          {" "}
          from <span className="font-medium">{activity.fromStage}</span>
        </>
      ) : null}
      {activity.toStage ? (
        <>
          {" "}
          to <span className="font-medium">{activity.toStage}</span>
        </>
      ) : null}
    </span>
  )
}

function LeadActivityItem({ activity }: { activity: MappedActivity }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span>
        <span className="font-medium">{activity.activityType}</span>
        {activity.updatedAt ? (
          <span className="text-muted-foreground"> · edited</span>
        ) : null}
      </span>
      <LeadActivityMeta activity={activity} />
      {activity.remarks ? (
        <p className="text-muted-foreground">{activity.remarks}</p>
      ) : null}
      <span className="text-muted-foreground text-xs">
        {formatDateTime(activity.activityDate ?? activity.createdAt)}
        {activity.createdByName ? ` · ${activity.createdByName}` : null}
      </span>
    </div>
  )
}

function LeadActivityMeta({ activity }: { activity: MappedActivity }) {
  const parts: string[] = []
  if (activity.callOutcome) parts.push(`Outcome: ${activity.callOutcome}`)
  if (activity.callDirection) parts.push(`Direction: ${activity.callDirection}`)
  if (activity.meetingOutcome) parts.push(`Outcome: ${activity.meetingOutcome}`)
  if (activity.locationType) parts.push(activity.locationType)
  if (activity.location) parts.push(activity.location)
  if (parts.length === 0) {
    return null
  }
  return <p className="text-muted-foreground text-xs">{parts.join(" · ")}</p>
}
