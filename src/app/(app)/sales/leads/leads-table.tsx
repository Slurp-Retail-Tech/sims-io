"use client"

import * as React from "react"
import Link from "next/link"

import { formatDateTime } from "@/lib/dates"
import { getSessionUser } from "@/lib/session"
import { useToast } from "@/components/toast-provider"
import { Button } from "@/components/ui/button"
import { NewLeadDialog } from "./new-lead-dialog"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from "@/components/ui/pagination"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Separator } from "@/components/ui/separator"
import type { AssignableUser } from "./types"

type LeadRow = {
  id: string
  name: string
  telephone: string
  businessType: string
  businessLocation: string
  source: string | null
  createdAt: string
  archived: boolean
  assignedUserId: string | null
  assignedUserName: string | null
}

type LeadNotificationSettings = {
  isEnabled: boolean
  recipientsText: string
  updatedAt: string
  updatedBy: string | null
}

const perPageOptions = [10, 25, 50, 100]

const ALL_VALUE = "__all__"
const UNASSIGNED_VALUE = "__unassigned__"

type StatusFilter = "active" | "archived" | "all"

function getPaginationItems(current: number, total: number) {
  if (total <= 7) {
    return Array.from({ length: total }, (_, index) => index + 1)
  }
  if (current <= 3) {
    return [1, 2, 3, 4, "ellipsis", total] as const
  }
  if (current >= total - 2) {
    return [1, "ellipsis", total - 3, total - 2, total - 1, total] as const
  }
  return [1, "ellipsis", current - 1, current, current + 1, "ellipsis", total] as const
}

export default function LeadsTable() {
  const { showToast } = useToast()
  const sessionUser = React.useMemo(() => getSessionUser(), [])
  const canManageNotificationSettings =
    sessionUser?.role === "Admin" || sessionUser?.role === "Super Admin"
  const isManager =
    sessionUser?.role === "Admin" || sessionUser?.role === "Super Admin"
  const [newLeadDialogOpen, setNewLeadDialogOpen] = React.useState(false)
  const [leads, setLeads] = React.useState<LeadRow[]>([])
  const [loading, setLoading] = React.useState(true)
  const [searchInput, setSearchInput] = React.useState("")
  const [searchQuery, setSearchQuery] = React.useState("")
  const [page, setPage] = React.useState(1)
  const [perPage, setPerPage] = React.useState(25)
  const [total, setTotal] = React.useState(0)

  // Filters.
  const [statusFilter, setStatusFilter] = React.useState<StatusFilter>("active")
  const [businessTypeFilter, setBusinessTypeFilter] = React.useState<string>(ALL_VALUE)
  const [assignedFilter, setAssignedFilter] = React.useState<string>(ALL_VALUE)
  const [businessTypes, setBusinessTypes] = React.useState<string[]>([])
  const [assignableUsers, setAssignableUsers] = React.useState<AssignableUser[]>([])

  const [assigningLeadId, setAssigningLeadId] = React.useState<string | null>(null)

  const [settings, setSettings] = React.useState<LeadNotificationSettings>({
    isEnabled: true,
    recipientsText: "",
    updatedAt: "",
    updatedBy: null,
  })
  const [settingsLoading, setSettingsLoading] = React.useState(true)
  const [settingsSaving, setSettingsSaving] = React.useState(false)
  const [settingsError, setSettingsError] = React.useState<string | null>(null)
  const [settingsDialogOpen, setSettingsDialogOpen] = React.useState(false)

  const totalPages = Math.max(1, Math.ceil(total / perPage))
  const paginationItems = React.useMemo(() => getPaginationItems(page, totalPages), [page, totalPages])
  const resultsLabel = `${total} result${total === 1 ? "" : "s"}`

  React.useEffect(() => {
    const handle = setTimeout(() => {
      setSearchQuery(searchInput.trim())
    }, 300)
    return () => clearTimeout(handle)
  }, [searchInput])

  React.useEffect(() => {
    setPage(1)
  }, [searchQuery, perPage, statusFilter, businessTypeFilter, assignedFilter])

  const loadLeads = React.useCallback(async () => {
    const user = getSessionUser()
    if (!user?.id) {
      setLoading(false)
      return
    }

    setLoading(true)
    try {
      const params = new URLSearchParams()
      params.set(
        "archived",
        statusFilter === "all" ? "all" : statusFilter === "archived" ? "true" : "false"
      )
      params.set("page", String(page))
      params.set("per_page", String(perPage))
      if (searchQuery) {
        params.set("q", searchQuery)
      }
      if (businessTypeFilter !== ALL_VALUE) {
        params.set("business_type", businessTypeFilter)
      }
      if (assignedFilter === UNASSIGNED_VALUE) {
        params.set("assigned", "unassigned")
      } else if (assignedFilter !== ALL_VALUE) {
        params.set("assigned", assignedFilter)
      }

      const response = await fetch(`/api/leads?${params.toString()}`)
      if (!response.ok) {
        throw new Error("Unable to load leads.")
      }

      const data = (await response.json()) as { leads: LeadRow[]; total: number }
      setLeads(data.leads ?? [])
      setTotal(data.total ?? 0)
    } catch (error) {
      console.error(error)
      setLeads([])
      setTotal(0)
    } finally {
      setLoading(false)
    }
  }, [page, perPage, searchQuery, statusFilter, businessTypeFilter, assignedFilter])

  React.useEffect(() => {
    void loadLeads()
  }, [loadLeads])

  // Load filter option lists once.
  React.useEffect(() => {
    const user = getSessionUser()
    if (!user?.id) {
      return
    }
    const loadOptions = async () => {
      try {
        const [typesRes, usersRes] = await Promise.all([
          fetch("/api/leads/filter-options"),
          fetch("/api/users/sales-agents"),
        ])
        if (typesRes.ok) {
          const data = (await typesRes.json()) as { businessTypes: string[] }
          setBusinessTypes(data.businessTypes ?? [])
        }
        if (usersRes.ok) {
          const data = (await usersRes.json()) as { users: AssignableUser[] }
          setAssignableUsers(data.users ?? [])
        }
      } catch {
        // Filters degrade gracefully to "All" if options fail to load.
      }
    }
    void loadOptions()
  }, [])

  React.useEffect(() => {
    const user = getSessionUser()
    if (!user?.id) {
      setSettingsLoading(false)
      return
    }

    const loadSettings = async () => {
      setSettingsLoading(true)
      try {
        const response = await fetch("/api/leads/notification-settings")
        if (!response.ok) {
          throw new Error("Unable to load notification settings.")
        }

        const data = (await response.json()) as {
          settings: LeadNotificationSettings
        }
        setSettings(data.settings)
        setSettingsError(null)
      } catch (error) {
        console.error(error)
        setSettingsError("Unable to load email notification settings.")
      } finally {
        setSettingsLoading(false)
      }
    }

    void loadSettings()
  }, [])

  const handleAssign = React.useCallback(
    async (lead: LeadRow, nextValue: string) => {
      const nextUserId = nextValue === UNASSIGNED_VALUE ? null : nextValue
      if (nextUserId === lead.assignedUserId) {
        return
      }
      setAssigningLeadId(lead.id)
      const nextName =
        nextUserId === null
          ? null
          : assignableUsers.find((user) => user.id === nextUserId)?.name ?? null
      // Optimistic update.
      setLeads((current) =>
        current.map((item) =>
          item.id === lead.id
            ? { ...item, assignedUserId: nextUserId, assignedUserName: nextName }
            : item
        )
      )
      try {
        const response = await fetch(`/api/leads/${lead.id}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ assignedUserId: nextUserId }),
        })
        const data = (await response.json()) as { lead?: LeadRow; error?: string }
        if (!response.ok || !data.lead) {
          throw new Error(data.error || "Unable to update assignment.")
        }
        setLeads((current) =>
          current.map((item) => (item.id === lead.id ? data.lead! : item))
        )
        showToast("Lead assignment updated.")
      } catch (error) {
        // Revert just this row to its pre-change value (avoids a full reload
        // that could clobber other rows' in-flight optimistic updates).
        setLeads((current) =>
          current.map((item) => (item.id === lead.id ? lead : item))
        )
        showToast(
          error instanceof Error ? error.message : "Unable to update assignment.",
          "error"
        )
      } finally {
        setAssigningLeadId(null)
      }
    },
    [assignableUsers, showToast]
  )

  const handleSaveSettings = React.useCallback(async () => {
    const user = getSessionUser()
    if (!user?.id || settingsSaving) {
      return
    }

    setSettingsSaving(true)
    setSettingsError(null)
    try {
      const response = await fetch("/api/leads/notification-settings", {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          isEnabled: settings.isEnabled,
          recipients: settings.recipientsText,
        }),
      })

      const data = (await response.json()) as {
        error?: string
        settings?: LeadNotificationSettings
      }
      if (!response.ok || !data.settings) {
        throw new Error(data.error || "Unable to save notification settings.")
      }

      setSettings(data.settings)
      showToast("Lead notification settings saved.")
    } catch (error) {
      console.error(error)
      setSettingsError(
        error instanceof Error ? error.message : "Unable to save notification settings."
      )
    } finally {
      setSettingsSaving(false)
    }
  }, [settings, settingsSaving, showToast])

  return (
    <div className="animate-in fade-in slide-in-from-bottom-2 flex flex-col gap-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Sales Leads</h1>
          <p className="text-muted-foreground text-sm">
            Qualify inbound leads and schedule follow ups.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={() => setSettingsDialogOpen(true)}>
            Email notifications
          </Button>
          <Button size="sm" variant="outline" asChild>
            <a href="/demoform" target="_blank" rel="noreferrer">
              Open Demo Form
            </a>
          </Button>
          <Button size="sm" onClick={() => setNewLeadDialogOpen(true)}>
            New Lead
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader className="space-y-3">
          <CardTitle className="text-base">Lead pipeline</CardTitle>
          <Input
            placeholder="Search by name, phone, or location"
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
          />
          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
            <Select
              value={statusFilter}
              onValueChange={(value) => setStatusFilter(value as StatusFilter)}
            >
              <SelectTrigger className="h-9 w-full text-xs sm:w-[160px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="active">Active leads</SelectItem>
                <SelectItem value="archived">Archived leads</SelectItem>
                <SelectItem value="all">All leads</SelectItem>
              </SelectContent>
            </Select>
            <Select value={businessTypeFilter} onValueChange={setBusinessTypeFilter}>
              <SelectTrigger className="h-9 w-full text-xs sm:w-[180px]">
                <SelectValue placeholder="Business type" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL_VALUE}>All business types</SelectItem>
                {businessTypes.map((type) => (
                  <SelectItem key={type} value={type}>
                    {type}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={assignedFilter} onValueChange={setAssignedFilter}>
              <SelectTrigger className="h-9 w-full text-xs sm:w-[180px]">
                <SelectValue placeholder="Assigned user" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL_VALUE}>All assignees</SelectItem>
                <SelectItem value={UNASSIGNED_VALUE}>Unassigned</SelectItem>
                {assignableUsers.map((user) => (
                  <SelectItem key={user.id} value={user.id}>
                    {user.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {loading ? (
            <div className="text-muted-foreground text-sm">Loading leads...</div>
          ) : leads.length ? (
            <div className="space-y-4">
              <div className="overflow-x-auto rounded-lg border bg-card">
                <div className="flex items-center justify-between border-b px-4 py-3">
                  <div className="text-base font-semibold">Leads</div>
                  <div className="text-xs text-muted-foreground">{resultsLabel}</div>
                </div>
                <table className="w-full text-sm">
                  <thead className="bg-muted/50 text-left text-xs font-semibold text-muted-foreground">
                    <tr>
                      <th className="px-4 py-3">ID</th>
                      <th className="px-4 py-3">Lead</th>
                      <th className="px-4 py-3">Contacts</th>
                      <th className="px-4 py-3">Business</th>
                      <th className="px-4 py-3">Source</th>
                      <th className="px-4 py-3">Created</th>
                      <th className="px-4 py-3">Assigned</th>
                      <th className="px-4 py-3">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {leads.map((lead, index) => (
                      <tr
                        key={lead.id}
                        className={index % 2 === 0 ? "bg-background" : "bg-muted/20"}
                      >
                        <td className="px-4 py-3 font-medium">
                          <Link
                            href={`/sales/leads/${lead.id}`}
                            className="hover:underline"
                          >
                            #{lead.id}
                          </Link>
                        </td>
                        <td className="px-4 py-3 text-xs">
                          <Link
                            href={`/sales/leads/${lead.id}`}
                            className="font-semibold hover:underline"
                          >
                            {lead.name}
                          </Link>
                          {lead.archived ? (
                            <span className="ml-2 rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                              Archived
                            </span>
                          ) : null}
                        </td>
                        <td className="px-4 py-3 text-xs">
                          <div>{lead.telephone || "--"}</div>
                        </td>
                        <td className="px-4 py-3 text-xs">
                          <div>{lead.businessType || "--"}</div>
                          <div className="text-muted-foreground">
                            {lead.businessLocation || "--"}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-xs capitalize">
                          {lead.source || "--"}
                        </td>
                        <td className="px-4 py-3 text-xs text-muted-foreground">
                          {formatDateTime(lead.createdAt)}
                        </td>
                        <td className="px-4 py-3 text-xs">
                          {isManager ? (
                            <Select
                              value={lead.assignedUserId ?? UNASSIGNED_VALUE}
                              disabled={assigningLeadId === lead.id}
                              onValueChange={(value) => void handleAssign(lead, value)}
                            >
                              <SelectTrigger className="h-8 w-[150px] text-xs">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value={UNASSIGNED_VALUE}>Unassigned</SelectItem>
                                {assignableUsers.map((user) => (
                                  <SelectItem key={user.id} value={user.id}>
                                    {user.name}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          ) : (
                            <span className="text-muted-foreground">
                              {lead.assignedUserName ?? "Unassigned"}
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <Button size="sm" variant="outline" asChild>
                            <Link href={`/sales/leads/${lead.id}`}>View</Link>
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="flex flex-col gap-3 pt-2">
                <Separator />
                <div className="grid w-full grid-cols-1 gap-3 text-xs text-muted-foreground md:grid-cols-[1fr_auto_1fr] md:items-center">
                  <div className="flex items-center gap-3">
                    <Select value={String(perPage)} onValueChange={(value) => setPerPage(Number(value))}>
                      <SelectTrigger className="h-8 w-[130px] text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {perPageOptions.map((option) => (
                          <SelectItem key={option} value={String(option)}>
                            {option} / page
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  {totalPages > 1 ? (
                    <Pagination className="md:justify-self-center">
                      <PaginationContent>
                        <PaginationItem>
                          <PaginationPrevious
                            href="#"
                            aria-disabled={page === 1}
                            tabIndex={page === 1 ? -1 : undefined}
                            className={page === 1 ? "pointer-events-none opacity-50" : undefined}
                            onClick={(event) => {
                              event.preventDefault()
                              if (page > 1) {
                                setPage((current) => current - 1)
                              }
                            }}
                          />
                        </PaginationItem>
                        {paginationItems.map((item, index) => (
                          <PaginationItem key={`${item}-${index}`}>
                            {item === "ellipsis" ? (
                              <PaginationEllipsis />
                            ) : (
                              <PaginationLink
                                href="#"
                                isActive={item === page}
                                onClick={(event) => {
                                  event.preventDefault()
                                  setPage(item)
                                }}
                              >
                                {item}
                              </PaginationLink>
                            )}
                          </PaginationItem>
                        ))}
                        <PaginationItem>
                          <PaginationNext
                            href="#"
                            aria-disabled={page === totalPages}
                            tabIndex={page === totalPages ? -1 : undefined}
                            className={
                              page === totalPages ? "pointer-events-none opacity-50" : undefined
                            }
                            onClick={(event) => {
                              event.preventDefault()
                              if (page < totalPages) {
                                setPage((current) => current + 1)
                              }
                            }}
                          />
                        </PaginationItem>
                      </PaginationContent>
                    </Pagination>
                  ) : (
                    <div />
                  )}
                </div>
              </div>
            </div>
          ) : (
            <div className="text-muted-foreground text-sm">No leads match the selected filters.</div>
          )}
        </CardContent>
      </Card>

      <NewLeadDialog
        open={newLeadDialogOpen}
        isManager={isManager}
        onClose={() => setNewLeadDialogOpen(false)}
        onCreated={() => void loadLeads()}
      />

      <Dialog open={settingsDialogOpen} onOpenChange={setSettingsDialogOpen}>
        <DialogContent className="max-h-[85vh] max-w-lg overflow-y-auto">
          <DialogHeader>
            <DialogTitle>New lead email notification</DialogTitle>
            <DialogDescription>
              Control email notifications for new demoform submissions.
              {!settingsLoading && !canManageNotificationSettings ? " View only." : ""}
            </DialogDescription>
          </DialogHeader>
          {settingsLoading ? (
            <div className="text-muted-foreground text-sm">Loading notification settings...</div>
          ) : (
            <div className="space-y-4">
              <label className="flex items-center gap-3 rounded-lg border px-4 py-3 text-sm">
                <input
                  type="checkbox"
                  className="size-4"
                  checked={settings.isEnabled}
                  disabled={!canManageNotificationSettings}
                  onChange={(event) => {
                    setSettings((current) => ({
                      ...current,
                      isEnabled: event.target.checked,
                    }))
                  }}
                />
                <div>
                  <div className="font-medium">Enable email notification</div>
                  <div className="text-muted-foreground text-xs">
                    Send an SMTP email when a new lead is submitted from the demoform.
                  </div>
                </div>
              </label>

              <div className="space-y-2">
                <div className="text-sm font-medium">Recipients</div>
                <textarea
                  className="border-input bg-background ring-offset-background placeholder:text-muted-foreground focus-visible:ring-ring min-h-28 w-full rounded-md border px-3 py-2 text-sm focus-visible:ring-2 focus-visible:outline-none"
                  placeholder={"marketing@getslurp.com\nsales@getslurp.com"}
                  value={settings.recipientsText}
                  disabled={!canManageNotificationSettings}
                  onChange={(event) => {
                    const value = event.target.value
                    setSettings((current) => ({ ...current, recipientsText: value }))
                  }}
                />
                <p className="text-muted-foreground text-xs">
                  One email per line. These addresses receive new demo lead alerts.
                </p>
              </div>

              {settingsError ? (
                <div className="text-sm text-red-600">{settingsError}</div>
              ) : null}

              <DialogFooter className="flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="text-muted-foreground text-xs">
                  {canManageNotificationSettings
                    ? settings.updatedAt
                      ? `Last updated ${formatDateTime(settings.updatedAt)}`
                      : " "
                    : "Only Admins and Super Admins can make changes."}
                </div>
                <Button
                  size="sm"
                  onClick={() => void handleSaveSettings()}
                  disabled={settingsSaving || !canManageNotificationSettings}
                >
                  {settingsSaving ? "Saving..." : "Save notification settings"}
                </Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
