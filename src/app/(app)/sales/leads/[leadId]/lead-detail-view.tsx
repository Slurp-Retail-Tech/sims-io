"use client"

import * as React from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { ChevronLeft, ChevronRight } from "lucide-react"

import { formatDate, formatDateTime } from "@/lib/dates"
import { formatCurrency } from "@/lib/currency"
import { getSessionUser } from "@/lib/session"
import { useToast } from "@/components/toast-provider"
import { useSetBreadcrumbLabel } from "@/components/breadcrumb-context"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import type { MappedLead } from "@/lib/leads"
import type { MappedDeal } from "@/lib/deals"
import { ACTIVITY_TYPES, type MappedActivity } from "@/lib/lead-activities"
import { DealDialog } from "../deal-dialog"
import { ActivityDialog } from "../activity-dialog"
import { LeadEditDialog } from "../lead-edit-dialog"

type LeadNavigation = {
  previousLeadId: string | null
  nextLeadId: string | null
}

export function LeadDetailView({ leadId }: { leadId: string }) {
  const { showToast } = useToast()
  const router = useRouter()
  const sessionUser = React.useMemo(() => getSessionUser(), [])
  const isManager =
    sessionUser?.role === "Admin" || sessionUser?.role === "Super Admin"

  const [lead, setLead] = React.useState<MappedLead | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [navigation, setNavigation] = React.useState<LeadNavigation>({
    previousLeadId: null,
    nextLeadId: null,
  })
  const [archiveConfirmOpen, setArchiveConfirmOpen] = React.useState(false)
  const [archiving, setArchiving] = React.useState(false)

  // Show the lead name (not the raw id) in the global breadcrumb.
  useSetBreadcrumbLabel(`/sales/leads/${leadId}`, lead?.name ?? null)

  const [editDialogOpen, setEditDialogOpen] = React.useState(false)

  const [deals, setDeals] = React.useState<MappedDeal[]>([])
  const [dealsLoading, setDealsLoading] = React.useState(true)
  const [dealDialogOpen, setDealDialogOpen] = React.useState(false)
  const [editingDeal, setEditingDeal] = React.useState<MappedDeal | null>(null)
  const [deletingDeal, setDeletingDeal] = React.useState<MappedDeal | null>(null)
  const [deletingDealId, setDeletingDealId] = React.useState<string | null>(null)

  const [activities, setActivities] = React.useState<MappedActivity[]>([])
  const [activitiesLoading, setActivitiesLoading] = React.useState(true)
  const [activityFilter, setActivityFilter] = React.useState<string>("All")
  const [activityDialogOpen, setActivityDialogOpen] = React.useState(false)
  const [editingActivity, setEditingActivity] = React.useState<MappedActivity | null>(null)
  const [deletingActivity, setDeletingActivity] = React.useState<MappedActivity | null>(null)
  const [deletingActivityId, setDeletingActivityId] = React.useState<string | null>(null)

  const canEdit = Boolean(
    lead && (isManager || lead.assignedUserId === sessionUser?.id)
  )

  const loadLead = React.useCallback(async () => {
    setLoading(true)
    setError(null)
    // Drop the previous lead so the breadcrumb/title don't show a stale name
    // while navigating between leads via Previous/Next.
    setLead(null)
    try {
      const response = await fetch(`/api/leads/${leadId}`)
      if (response.status === 404) {
        throw new Error("Lead not found.")
      }
      if (!response.ok) {
        throw new Error("Unable to load lead.")
      }
      const data = (await response.json()) as {
        lead: MappedLead
        navigation?: LeadNavigation
      }
      setLead(data.lead)
      setNavigation(
        data.navigation ?? { previousLeadId: null, nextLeadId: null }
      )
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load lead.")
      setLead(null)
    } finally {
      setLoading(false)
    }
  }, [leadId])

  const loadDeals = React.useCallback(async () => {
    setDealsLoading(true)
    try {
      const response = await fetch(`/api/leads/${leadId}/deals`)
      if (!response.ok) {
        throw new Error("Unable to load deals.")
      }
      const data = (await response.json()) as { deals: MappedDeal[] }
      setDeals(data.deals ?? [])
    } catch {
      setDeals([])
    } finally {
      setDealsLoading(false)
    }
  }, [leadId])

  const loadActivities = React.useCallback(async () => {
    setActivitiesLoading(true)
    try {
      const params = new URLSearchParams()
      if (activityFilter !== "All") {
        params.set("type", activityFilter)
      }
      const response = await fetch(
        `/api/leads/${leadId}/activities?${params.toString()}`
      )
      if (!response.ok) {
        throw new Error("Unable to load activities.")
      }
      const data = (await response.json()) as { activities: MappedActivity[] }
      setActivities(data.activities ?? [])
    } catch {
      setActivities([])
    } finally {
      setActivitiesLoading(false)
    }
  }, [leadId, activityFilter])

  React.useEffect(() => {
    void loadLead()
    void loadDeals()
  }, [loadLead, loadDeals])

  React.useEffect(() => {
    void loadActivities()
  }, [loadActivities])

  const handleDealSaved = (saved: MappedDeal) => {
    setDeals((current) => {
      const exists = current.some((d) => d.id === saved.id)
      return exists
        ? current.map((d) => (d.id === saved.id ? saved : d))
        : [saved, ...current]
    })
  }

  const handleActivitySaved = () => {
    // Refetch to respect the current filter and ordering.
    void loadActivities()
  }

  const openLogActivity = () => {
    setEditingActivity(null)
    setActivityDialogOpen(true)
  }

  const openEditActivity = (activity: MappedActivity) => {
    setEditingActivity(activity)
    setActivityDialogOpen(true)
  }

  const handleDeleteActivity = async (activity: MappedActivity) => {
    setDeletingActivityId(activity.id)
    try {
      const response = await fetch(
        `/api/leads/${leadId}/activities/${activity.id}`,
        { method: "DELETE" }
      )
      if (!response.ok) {
        const data = (await response.json().catch(() => ({}))) as { error?: string }
        throw new Error(data.error || "Unable to delete activity.")
      }
      setActivities((current) => current.filter((item) => item.id !== activity.id))
      showToast("Activity deleted.")
    } catch (error) {
      showToast(
        error instanceof Error ? error.message : "Unable to delete activity.",
        "error"
      )
    } finally {
      setDeletingActivityId(null)
      setDeletingActivity(null)
    }
  }

  const handleDeleteDeal = async (deal: MappedDeal) => {
    setDeletingDealId(deal.id)
    try {
      const response = await fetch(`/api/leads/${leadId}/deals/${deal.id}`, {
        method: "DELETE",
      })
      if (!response.ok) {
        const data = (await response.json().catch(() => ({}))) as { error?: string }
        throw new Error(data.error || "Unable to delete deal.")
      }
      setDeals((current) => current.filter((item) => item.id !== deal.id))
      showToast("Deal deleted.")
    } catch (error) {
      showToast(
        error instanceof Error ? error.message : "Unable to delete deal.",
        "error"
      )
    } finally {
      setDeletingDealId(null)
      setDeletingDeal(null)
    }
  }

  const handleToggleArchived = async () => {
    if (!lead) {
      return
    }
    const nextArchived = !lead.archived
    setArchiving(true)
    try {
      const response = await fetch(`/api/leads/${leadId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ archived: nextArchived }),
      })
      const data = (await response.json()) as { lead?: MappedLead; error?: string }
      if (!response.ok || !data.lead) {
        throw new Error(data.error || "Unable to update lead.")
      }
      setLead(data.lead)
      showToast(nextArchived ? "Lead archived." : "Lead unarchived.")
    } catch (error) {
      showToast(
        error instanceof Error ? error.message : "Unable to update lead.",
        "error"
      )
    } finally {
      setArchiving(false)
      setArchiveConfirmOpen(false)
    }
  }

  if (loading) {
    return (
      <div className="text-muted-foreground text-sm">Loading lead...</div>
    )
  }

  if (error || !lead) {
    return (
      <div className="flex flex-col gap-4">
        <div className="text-sm text-red-600">{error ?? "Lead not found."}</div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={() => void loadLead()}>
            Retry
          </Button>
          <Button size="sm" variant="ghost" asChild>
            <Link href="/sales/leads">Back to leads</Link>
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="animate-in fade-in slide-in-from-bottom-2 flex flex-col gap-6">
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Button asChild variant="outline" size="sm">
            <Link href="/sales/leads">
              <ChevronLeft className="size-4" />
              Back to leads
            </Link>
          </Button>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={!navigation.previousLeadId}
              onClick={() => {
                if (navigation.previousLeadId) {
                  router.push(`/sales/leads/${navigation.previousLeadId}`)
                }
              }}
            >
              <ChevronLeft className="size-4" />
              Previous
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={!navigation.nextLeadId}
              onClick={() => {
                if (navigation.nextLeadId) {
                  router.push(`/sales/leads/${navigation.nextLeadId}`)
                }
              }}
            >
              Next
              <ChevronRight className="size-4" />
            </Button>
          </div>
        </div>
        <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-semibold tracking-tight">{lead.name}</h1>
              {lead.archived ? (
                <span className="rounded bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
                  Archived
                </span>
              ) : null}
            </div>
            <p className="text-muted-foreground text-sm">Lead #{lead.id}</p>
          </div>
          {canEdit ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setArchiveConfirmOpen(true)}
            >
              {lead.archived ? "Unarchive lead" : "Archive lead"}
            </Button>
          ) : null}
        </div>
      </div>

      {/* Lead details */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
          <CardTitle className="text-base">Lead details</CardTitle>
          {canEdit ? (
            <Button size="sm" variant="outline" onClick={() => setEditDialogOpen(true)}>
              Edit
            </Button>
          ) : null}
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-1 gap-4 text-sm sm:grid-cols-2">
            <DetailRow label="Telephone" value={lead.telephone} />
            <DetailRow label="Email" value={lead.email ?? "--"} />
            <DetailRow label="Business name" value={lead.businessName ?? "--"} />
            <DetailRow label="Business type" value={lead.businessType} />
            <DetailRow label="Business location" value={lead.businessLocation} />
            <DetailRow label="Source" value={lead.source ?? "--"} capitalize />
            <DetailRow label="Assigned to" value={lead.assignedUserName ?? "Unassigned"} />
            <DetailRow label="Created" value={formatDateTime(lead.createdAt)} />
          </dl>
        </CardContent>
      </Card>

      {/* Activity log (left) + Deals (right) */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Activity log */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
            <CardTitle className="text-base">Activity log</CardTitle>
            <div className="flex items-center gap-2">
              <Select value={activityFilter} onValueChange={setActivityFilter}>
                <SelectTrigger className="h-8 w-[160px] text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="All">All activities</SelectItem>
                  {ACTIVITY_TYPES.map((type) => (
                    <SelectItem key={type} value={type}>
                      {type}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {canEdit ? (
                <Button size="sm" variant="outline" onClick={openLogActivity}>
                  Log activity
                </Button>
              ) : null}
            </div>
          </CardHeader>
          <CardContent>
            {activitiesLoading ? (
              <div className="text-muted-foreground text-sm">Loading activities...</div>
            ) : activities.length ? (
              <ul className="flex flex-col gap-3">
                {activities.map((activity) => (
                  <li key={activity.id} className="rounded-lg border px-4 py-3 text-sm">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium">{activity.activityType}</span>
                      <div className="flex items-center gap-2">
                        <span className="text-muted-foreground text-xs">
                          {activity.activityDate
                            ? formatDateTime(activity.activityDate)
                            : formatDateTime(activity.createdAt)}
                          {activity.updatedAt ? " · edited" : null}
                        </span>
                        {canEdit ? (
                          <div className="flex items-center gap-1">
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 px-2 text-xs"
                              onClick={() => openEditActivity(activity)}
                            >
                              Edit
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="text-destructive hover:text-destructive h-7 px-2 text-xs"
                              disabled={deletingActivityId === activity.id}
                              onClick={() => setDeletingActivity(activity)}
                            >
                              {deletingActivityId === activity.id ? "Deleting..." : "Delete"}
                            </Button>
                          </div>
                        ) : null}
                      </div>
                    </div>
                    <ActivityMeta activity={activity} />
                    {activity.remarks ? (
                      <p className="text-muted-foreground mt-1">{activity.remarks}</p>
                    ) : null}
                    {activity.createdByName ? (
                      <p className="text-muted-foreground mt-1 text-xs">
                        Logged by {activity.createdByName}
                      </p>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : (
              <div className="text-muted-foreground text-sm">
                {activityFilter === "All"
                  ? "No activities logged yet."
                  : "No activities match this filter."}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Deals */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
            <CardTitle className="text-base">Deals</CardTitle>
            {canEdit ? (
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setEditingDeal(null)
                  setDealDialogOpen(true)
                }}
              >
                Add deal
              </Button>
            ) : null}
          </CardHeader>
          <CardContent>
            {dealsLoading ? (
              <div className="text-muted-foreground text-sm">Loading deals...</div>
            ) : deals.length ? (
              <div className="overflow-x-auto rounded-lg border">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50 text-left text-xs font-semibold text-muted-foreground">
                    <tr>
                      <th className="px-4 py-3">Deal</th>
                      <th className="px-4 py-3">Stage</th>
                      <th className="px-4 py-3">Amount</th>
                      <th className="px-4 py-3">Closed date</th>
                      {canEdit ? <th className="px-4 py-3" /> : null}
                    </tr>
                  </thead>
                  <tbody>
                    {deals.map((deal, index) => (
                      <tr key={deal.id} className={index % 2 === 0 ? "bg-background" : "bg-muted/20"}>
                        <td className="px-4 py-3 font-medium">{deal.dealName}</td>
                        <td className="px-4 py-3">{deal.dealStage}</td>
                        <td className="px-4 py-3">{formatCurrency(deal.amount)}</td>
                        <td className="px-4 py-3 text-muted-foreground">
                          {deal.closedDate ? formatDate(deal.closedDate) : "--"}
                        </td>
                        {canEdit ? (
                          <td className="px-4 py-3 text-right">
                            <div className="flex items-center justify-end gap-1">
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => {
                                  setEditingDeal(deal)
                                  setDealDialogOpen(true)
                                }}
                              >
                                Edit
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                className="text-destructive hover:text-destructive"
                                disabled={deletingDealId === deal.id}
                                onClick={() => setDeletingDeal(deal)}
                              >
                                {deletingDealId === deal.id ? "Deleting..." : "Delete"}
                              </Button>
                            </div>
                          </td>
                        ) : null}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="text-muted-foreground text-sm">No deals yet.</div>
            )}
          </CardContent>
        </Card>
      </div>

      <LeadEditDialog
        leadId={leadId}
        lead={lead}
        isManager={isManager}
        open={editDialogOpen}
        onClose={() => setEditDialogOpen(false)}
        onSaved={(updated) => setLead(updated)}
      />
      <DealDialog
        leadId={leadId}
        deal={editingDeal}
        open={dealDialogOpen}
        onClose={() => setDealDialogOpen(false)}
        onSaved={handleDealSaved}
      />
      <ActivityDialog
        leadId={leadId}
        activity={editingActivity}
        open={activityDialogOpen}
        onClose={() => setActivityDialogOpen(false)}
        onSaved={handleActivitySaved}
      />

      <ConfirmDialog
        open={archiveConfirmOpen}
        onOpenChange={setArchiveConfirmOpen}
        title={lead.archived ? "Unarchive lead" : "Archive lead"}
        description={
          lead.archived
            ? `Are you sure you want to unarchive "${lead.name}"?`
            : `Are you sure you want to archive "${lead.name}"?`
        }
        confirmLabel={lead.archived ? "Unarchive" : "Archive"}
        loading={archiving}
        onConfirm={() => void handleToggleArchived()}
      />

      <ConfirmDialog
        open={deletingDeal !== null}
        onOpenChange={(open) => {
          if (!open) setDeletingDeal(null)
        }}
        title="Delete deal"
        description={
          deletingDeal
            ? `Are you sure you want to delete "${deletingDeal.dealName}"? This cannot be undone.`
            : undefined
        }
        confirmLabel="Delete"
        destructive
        loading={deletingDealId !== null}
        onConfirm={() => {
          if (deletingDeal) {
            void handleDeleteDeal(deletingDeal)
          }
        }}
      />

      <ConfirmDialog
        open={deletingActivity !== null}
        onOpenChange={(open) => {
          if (!open) setDeletingActivity(null)
        }}
        title="Delete activity"
        description="Are you sure you want to delete this activity? This cannot be undone."
        confirmLabel="Delete"
        destructive
        loading={deletingActivityId !== null}
        onConfirm={() => {
          if (deletingActivity) {
            void handleDeleteActivity(deletingActivity)
          }
        }}
      />
    </div>
  )
}

function DetailRow({
  label,
  value,
  capitalize,
}: {
  label: string
  value: string
  capitalize?: boolean
}) {
  return (
    <div className="flex flex-col gap-1">
      <dt className="text-muted-foreground text-xs uppercase tracking-wide">{label}</dt>
      <dd className={capitalize ? "capitalize" : undefined}>{value}</dd>
    </div>
  )
}

function ActivityMeta({ activity }: { activity: MappedActivity }) {
  const parts: string[] = []
  if (activity.callOutcome) parts.push(`Outcome: ${activity.callOutcome}`)
  if (activity.callDirection) parts.push(`Direction: ${activity.callDirection}`)
  if (activity.meetingOutcome) parts.push(`Outcome: ${activity.meetingOutcome}`)
  if (activity.locationType) parts.push(activity.locationType)
  if (activity.location) parts.push(activity.location)
  if (parts.length === 0) {
    return null
  }
  return <p className="text-muted-foreground mt-1 text-xs">{parts.join(" · ")}</p>
}
