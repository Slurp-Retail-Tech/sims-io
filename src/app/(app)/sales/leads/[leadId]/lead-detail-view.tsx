"use client"

import * as React from "react"
import Link from "next/link"

import { formatDate, formatDateTime } from "@/lib/dates"
import { formatCurrency } from "@/lib/currency"
import { getSessionUser } from "@/lib/session"
import { useToast } from "@/components/toast-provider"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Field, FieldError, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
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
import type { AssignableUser } from "../types"

const UNASSIGNED_VALUE = "__unassigned__"

type EditDraft = {
  name: string
  telephone: string
  email: string
  businessName: string
  businessType: string
  businessLocation: string
  assignedUserId: string
}

function draftFromLead(lead: MappedLead): EditDraft {
  return {
    name: lead.name,
    telephone: lead.telephone,
    email: lead.email ?? "",
    businessName: lead.businessName ?? "",
    businessType: lead.businessType,
    businessLocation: lead.businessLocation,
    assignedUserId: lead.assignedUserId ?? UNASSIGNED_VALUE,
  }
}

export function LeadDetailView({ leadId }: { leadId: string }) {
  const { showToast } = useToast()
  const sessionUser = React.useMemo(() => getSessionUser(), [])
  const isManager =
    sessionUser?.role === "Admin" || sessionUser?.role === "Super Admin"

  const [lead, setLead] = React.useState<MappedLead | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)

  const [editing, setEditing] = React.useState(false)
  const [draft, setDraft] = React.useState<EditDraft | null>(null)
  const [editErrors, setEditErrors] = React.useState<Record<string, string>>({})
  const [saving, setSaving] = React.useState(false)
  const [assignableUsers, setAssignableUsers] = React.useState<AssignableUser[]>([])

  const [deals, setDeals] = React.useState<MappedDeal[]>([])
  const [dealsLoading, setDealsLoading] = React.useState(true)
  const [dealDialogOpen, setDealDialogOpen] = React.useState(false)
  const [editingDeal, setEditingDeal] = React.useState<MappedDeal | null>(null)

  const [activities, setActivities] = React.useState<MappedActivity[]>([])
  const [activitiesLoading, setActivitiesLoading] = React.useState(true)
  const [activityFilter, setActivityFilter] = React.useState<string>("All")
  const [activityDialogOpen, setActivityDialogOpen] = React.useState(false)
  const [editingActivity, setEditingActivity] = React.useState<MappedActivity | null>(null)
  const [deletingActivityId, setDeletingActivityId] = React.useState<string | null>(null)

  const canEdit = Boolean(
    lead && (isManager || lead.assignedUserId === sessionUser?.id)
  )

  const loadLead = React.useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const response = await fetch(`/api/leads/${leadId}`)
      if (response.status === 404) {
        throw new Error("Lead not found.")
      }
      if (!response.ok) {
        throw new Error("Unable to load lead.")
      }
      const data = (await response.json()) as { lead: MappedLead }
      setLead(data.lead)
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

  React.useEffect(() => {
    if (!editing || !isManager) {
      return
    }
    const loadUsers = async () => {
      try {
        const response = await fetch("/api/users/sales-agents")
        if (!response.ok) {
          return
        }
        const data = (await response.json()) as { users: AssignableUser[] }
        setAssignableUsers(data.users ?? [])
      } catch {
        // optional
      }
    }
    void loadUsers()
  }, [editing, isManager])

  const startEdit = () => {
    if (!lead) {
      return
    }
    setDraft(draftFromLead(lead))
    setEditErrors({})
    setEditing(true)
  }

  const cancelEdit = () => {
    setEditing(false)
    setDraft(null)
    setEditErrors({})
  }

  const saveEdit = async () => {
    if (!draft || !lead) {
      return
    }
    const nextErrors: Record<string, string> = {}
    if (!draft.name.trim()) nextErrors.name = "Name is required."
    if (!/^\d{8,15}$/.test(draft.telephone.trim())) {
      nextErrors.telephone = "Telephone must contain 8 to 15 digits."
    }
    if (!draft.businessType.trim()) nextErrors.businessType = "Business type is required."
    if (!draft.businessLocation.trim()) {
      nextErrors.businessLocation = "Business location is required."
    }
    setEditErrors(nextErrors)
    if (Object.keys(nextErrors).length > 0) {
      return
    }

    setSaving(true)
    try {
      const payload: Record<string, unknown> = {
        name: draft.name.trim(),
        telephone: draft.telephone.trim(),
        email: draft.email.trim() || null,
        businessName: draft.businessName.trim() || null,
        businessType: draft.businessType.trim(),
        businessLocation: draft.businessLocation.trim(),
      }
      // Only managers can change assignment.
      if (isManager) {
        payload.assignedUserId =
          draft.assignedUserId === UNASSIGNED_VALUE ? null : draft.assignedUserId
      }
      const response = await fetch(`/api/leads/${leadId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      })
      const data = (await response.json()) as { lead?: MappedLead; error?: string }
      if (!response.ok || !data.lead) {
        throw new Error(data.error || "Unable to save lead.")
      }
      setLead(data.lead)
      setEditing(false)
      setDraft(null)
      showToast("Lead updated.")
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Unable to save lead.", "error")
    } finally {
      setSaving(false)
    }
  }

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
    if (!window.confirm("Delete this activity? This cannot be undone.")) {
      return
    }
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
      <div className="flex flex-col gap-1">
        <Link href="/sales/leads" className="text-muted-foreground text-xs hover:underline">
          ← Sales Leads
        </Link>
        <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">{lead.name}</h1>
            <p className="text-muted-foreground text-sm">Lead #{lead.id}</p>
          </div>
        </div>
      </div>

      {/* Lead details */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
          <CardTitle className="text-base">Lead details</CardTitle>
          {canEdit && !editing ? (
            <Button size="sm" variant="outline" onClick={startEdit}>
              Edit
            </Button>
          ) : null}
        </CardHeader>
        <CardContent>
          {editing && draft ? (
            <div className="flex flex-col gap-5">
              <Field>
                <FieldLabel htmlFor="edit-name">Name</FieldLabel>
                <Input
                  id="edit-name"
                  value={draft.name}
                  onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                />
                <FieldError errors={editErrors.name ? [{ message: editErrors.name }] : undefined} />
              </Field>
              <Field>
                <FieldLabel htmlFor="edit-telephone">Telephone</FieldLabel>
                <Input
                  id="edit-telephone"
                  value={draft.telephone}
                  onChange={(e) => setDraft({ ...draft, telephone: e.target.value })}
                />
                <FieldError
                  errors={editErrors.telephone ? [{ message: editErrors.telephone }] : undefined}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="edit-email">Email</FieldLabel>
                <Input
                  id="edit-email"
                  type="email"
                  value={draft.email}
                  onChange={(e) => setDraft({ ...draft, email: e.target.value })}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="edit-business-name">Business name</FieldLabel>
                <Input
                  id="edit-business-name"
                  value={draft.businessName}
                  onChange={(e) => setDraft({ ...draft, businessName: e.target.value })}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="edit-business-type">Business type</FieldLabel>
                <Input
                  id="edit-business-type"
                  value={draft.businessType}
                  onChange={(e) => setDraft({ ...draft, businessType: e.target.value })}
                />
                <FieldError
                  errors={editErrors.businessType ? [{ message: editErrors.businessType }] : undefined}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="edit-business-location">Business location</FieldLabel>
                <Input
                  id="edit-business-location"
                  value={draft.businessLocation}
                  onChange={(e) => setDraft({ ...draft, businessLocation: e.target.value })}
                />
                <FieldError
                  errors={
                    editErrors.businessLocation
                      ? [{ message: editErrors.businessLocation }]
                      : undefined
                  }
                />
              </Field>
              {/* Source is read-only */}
              <Field>
                <FieldLabel>Source</FieldLabel>
                <Input value={lead.source ?? "--"} disabled readOnly className="capitalize" />
              </Field>
              {isManager ? (
                <Field>
                  <FieldLabel>Assigned to</FieldLabel>
                  <Select
                    value={draft.assignedUserId}
                    onValueChange={(value) => setDraft({ ...draft, assignedUserId: value })}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={UNASSIGNED_VALUE}>Unassigned</SelectItem>
                      {assignableUsers.map((agent) => (
                        <SelectItem key={agent.id} value={agent.id}>
                          {agent.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
              ) : null}
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={cancelEdit} disabled={saving}>
                  Cancel
                </Button>
                <Button onClick={() => void saveEdit()} disabled={saving}>
                  {saving ? "Saving..." : "Save"}
                </Button>
              </div>
            </div>
          ) : (
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
                            onClick={() => void handleDeleteActivity(activity)}
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
