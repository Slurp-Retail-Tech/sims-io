"use client"

import * as React from "react"
import { ChevronDown } from "lucide-react"

import { formatDateTime } from "@/lib/dates"
import { getSessionUser } from "@/lib/session"
import { useToast } from "@/components/toast-provider"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
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
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"

type LeadRow = {
  id: string
  name: string
  telephone: string
  email: string
  businessName: string
  businessType: string
  businessLocation: string
  hubspotSyncStatus: "Pending" | "Success" | "Failed" | "Skipped"
  hubspotSyncError: string | null
  createdAt: string
  archived: boolean
}

type LeadNotificationSettings = {
  isEnabled: boolean
  senderEmail: string
  recipientsText: string
  updatedAt: string
  updatedBy: string | null
}

const perPageOptions = [10, 25, 50, 100]

const statusStyles: Record<LeadRow["hubspotSyncStatus"], string> = {
  Pending: "text-amber-700 bg-amber-500/10 dark:text-amber-300",
  Success: "text-emerald-700 bg-emerald-500/10 dark:text-emerald-300",
  Failed: "text-red-700 bg-red-500/10 dark:text-red-300",
  Skipped: "text-primary bg-primary/10",
}

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
  const [leads, setLeads] = React.useState<LeadRow[]>([])
  const [archivedLeads, setArchivedLeads] = React.useState<LeadRow[]>([])
  const [loading, setLoading] = React.useState(true)
  const [archivedLoading, setArchivedLoading] = React.useState(false)
  const [archivedDialogOpen, setArchivedDialogOpen] = React.useState(false)
  const [searchInput, setSearchInput] = React.useState("")
  const [searchQuery, setSearchQuery] = React.useState("")
  const [page, setPage] = React.useState(1)
  const [perPage, setPerPage] = React.useState(25)
  const [total, setTotal] = React.useState(0)
  const [archivingLeadId, setArchivingLeadId] = React.useState<string | null>(null)
  const [confirmDialogOpen, setConfirmDialogOpen] = React.useState(false)
  const [settings, setSettings] = React.useState<LeadNotificationSettings>({
    isEnabled: true,
    senderEmail: "",
    recipientsText: "",
    updatedAt: "",
    updatedBy: null,
  })
  const [settingsLoading, setSettingsLoading] = React.useState(true)
  const [settingsSaving, setSettingsSaving] = React.useState(false)
  const [settingsError, setSettingsError] = React.useState<string | null>(null)
  const [settingsExpanded, setSettingsExpanded] = React.useState(false)
  const [pendingArchiveAction, setPendingArchiveAction] = React.useState<{
    lead: LeadRow
    archived: boolean
  } | null>(null)

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
  }, [searchQuery, perPage])

  const loadLeads = React.useCallback(async () => {
    const user = getSessionUser()
    if (!user?.id) {
      setLoading(false)
      return
    }

    setLoading(true)
    try {
      const params = new URLSearchParams()
      params.set("archived", "false")
      params.set("page", String(page))
      params.set("per_page", String(perPage))
      if (searchQuery) {
        params.set("q", searchQuery)
      }

      const response = await fetch(`/api/leads?${params.toString()}`, {
        headers: { "x-user-id": user.id },
      })
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
  }, [page, perPage, searchQuery])

  const loadArchivedLeads = React.useCallback(async () => {
    const user = getSessionUser()
    if (!user?.id) {
      return
    }

    setArchivedLoading(true)
    try {
      const params = new URLSearchParams()
      params.set("archived", "true")
      params.set("all", "true")

      const response = await fetch(`/api/leads?${params.toString()}`, {
        headers: { "x-user-id": user.id },
      })
      if (!response.ok) {
        throw new Error("Unable to load archived leads.")
      }

      const data = (await response.json()) as { leads: LeadRow[] }
      setArchivedLeads(data.leads ?? [])
    } catch (error) {
      console.error(error)
      setArchivedLeads([])
    } finally {
      setArchivedLoading(false)
    }
  }, [])

  React.useEffect(() => {
    void loadLeads()
  }, [loadLeads])

  React.useEffect(() => {
    const user = getSessionUser()
    if (!user?.id) {
      setSettingsLoading(false)
      return
    }

    const loadSettings = async () => {
      setSettingsLoading(true)
      try {
        const response = await fetch("/api/leads/notification-settings", {
          headers: { "x-user-id": user.id },
        })
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

  const handleSetArchived = React.useCallback(async (lead: LeadRow, archived: boolean) => {
    const user = getSessionUser()
    if (!user?.id || archivingLeadId) {
      return
    }

    setArchivingLeadId(lead.id)
    try {
      const response = await fetch(`/api/leads/${lead.id}`, {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
          "x-user-id": user.id,
        },
        body: JSON.stringify({ archived }),
      })

      if (!response.ok) {
        throw new Error(`Unable to ${archived ? "archive" : "unarchive"} lead.`)
      }

      await loadLeads()
      if (archivedDialogOpen) {
        await loadArchivedLeads()
      }
    } catch (error) {
      console.error(error)
    } finally {
      setArchivingLeadId(null)
    }
  }, [archivedDialogOpen, archivingLeadId, loadArchivedLeads, loadLeads])

  const requestSetArchived = React.useCallback((lead: LeadRow, archived: boolean) => {
    setPendingArchiveAction({ lead, archived })
    setConfirmDialogOpen(true)
  }, [])

  const openArchivedModal = React.useCallback(async () => {
    setArchivedDialogOpen(true)
    await loadArchivedLeads()
  }, [loadArchivedLeads])

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
          "x-user-id": user.id,
        },
        body: JSON.stringify({
          isEnabled: settings.isEnabled,
          senderEmail: settings.senderEmail,
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
          <Button size="sm" variant="outline" onClick={() => void openArchivedModal()}>
            Archived leads
          </Button>
          <Button size="sm" asChild>
            <a href="/demoform" target="_blank" rel="noreferrer">
              Open Demo Form
            </a>
          </Button>
        </div>
      </div>

      <Collapsible open={settingsExpanded} onOpenChange={setSettingsExpanded}>
        <Card>
          <CardHeader className="space-y-0">
            <CollapsibleTrigger className="flex w-full items-start justify-between gap-4 text-left">
              <div className="space-y-2">
                <CardTitle className="text-base">New lead email notification</CardTitle>
                <div className="text-muted-foreground text-sm">
                  Control Resend notifications for new demoform submissions.
                </div>
                <div className="text-xs text-muted-foreground">
                  {settingsLoading
                    ? "Loading notification settings..."
                    : settings.isEnabled
                      ? "Enabled"
                      : "Disabled"}
                  {!settingsLoading && !canManageNotificationSettings
                    ? " · View only"
                    : ""}
                </div>
              </div>
              <ChevronDown
                className={`mt-1 size-4 shrink-0 text-muted-foreground transition-transform ${
                  settingsExpanded ? "rotate-180" : ""
                }`}
              />
            </CollapsibleTrigger>
          </CardHeader>
          <CollapsibleContent>
            <CardContent className="space-y-4">
              {settingsLoading ? (
                <div className="text-muted-foreground text-sm">Loading notification settings...</div>
              ) : (
                <>
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
                        Send a Resend email when a new lead is submitted from the demoform.
                      </div>
                    </div>
                  </label>

                  <div className="grid gap-4 md:grid-cols-2">
                    <div className="space-y-2">
                      <label className="text-sm font-medium" htmlFor="lead-notification-sender">
                        Sender email
                      </label>
                      <Input
                        id="lead-notification-sender"
                        type="email"
                        placeholder="marketing@leads.getslurp.com"
                        value={settings.senderEmail}
                        disabled={!canManageNotificationSettings}
                        onChange={(event) => {
                          const value = event.target.value
                          setSettings((current) => ({ ...current, senderEmail: value }))
                        }}
                      />
                    </div>
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
                  </div>

                  <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
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
                  </div>

                  {settingsError ? (
                    <div className="text-sm text-red-600">{settingsError}</div>
                  ) : null}
                </>
              )}
            </CardContent>
          </CollapsibleContent>
        </Card>
      </Collapsible>

      <Card>
        <CardHeader className="space-y-2">
          <CardTitle className="text-base">Lead pipeline</CardTitle>
          <Input
            placeholder="Search by lead, contact, or business"
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
          />
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
                      <th className="px-4 py-3">HubSpot</th>
                      <th className="px-4 py-3">Created</th>
                      <th className="px-4 py-3">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {leads.map((lead, index) => (
                      <tr
                        key={lead.id}
                        className={index % 2 === 0 ? "bg-background" : "bg-muted/20"}
                      >
                        <td className="px-4 py-3 font-medium">#{lead.id}</td>
                        <td className="px-4 py-3 text-xs">
                          <div className="font-semibold">{lead.name}</div>
                          <div className="text-muted-foreground">
                            {lead.businessName || "--"}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-xs">
                          <div>{lead.telephone || "--"}</div>
                          <div className="text-muted-foreground">{lead.email || "--"}</div>
                        </td>
                        <td className="px-4 py-3 text-xs">
                          <div>{lead.businessType || "--"}</div>
                          <div className="text-muted-foreground">
                            {lead.businessLocation || "--"}
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          {lead.hubspotSyncStatus === "Failed" && lead.hubspotSyncError ? (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <span
                                  className={`inline-flex cursor-help items-center rounded-full px-3 py-1 text-xs font-semibold whitespace-nowrap ${statusStyles[lead.hubspotSyncStatus]}`}
                                >
                                  {lead.hubspotSyncStatus}
                                </span>
                              </TooltipTrigger>
                              <TooltipContent sideOffset={6}>
                                <div className="max-w-xs whitespace-pre-wrap">
                                  {lead.hubspotSyncError}
                                </div>
                              </TooltipContent>
                            </Tooltip>
                          ) : (
                            <span
                              className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold whitespace-nowrap ${statusStyles[lead.hubspotSyncStatus]}`}
                            >
                              {lead.hubspotSyncStatus}
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-xs text-muted-foreground">
                          {formatDateTime(lead.createdAt)}
                        </td>
                        <td className="px-4 py-3">
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={archivingLeadId === lead.id}
                            onClick={() => requestSetArchived(lead, true)}
                          >
                            {archivingLeadId === lead.id ? "Archiving..." : "Archive"}
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

      <Dialog open={archivedDialogOpen} onOpenChange={setArchivedDialogOpen}>
        <DialogContent className="max-h-[85vh] max-w-5xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Archived Leads</DialogTitle>
            <DialogDescription>
              All leads marked as archived.
            </DialogDescription>
          </DialogHeader>
          {archivedLoading ? (
            <div className="text-muted-foreground text-sm">Loading archived leads...</div>
          ) : archivedLeads.length ? (
            <div className="overflow-x-auto rounded-lg border bg-card">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-left text-xs font-semibold text-muted-foreground">
                  <tr>
                    <th className="px-4 py-3">ID</th>
                    <th className="px-4 py-3">Lead</th>
                    <th className="px-4 py-3">Contacts</th>
                    <th className="px-4 py-3">Business</th>
                    <th className="px-4 py-3">HubSpot</th>
                    <th className="px-4 py-3">Created</th>
                    <th className="px-4 py-3">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {archivedLeads.map((lead, index) => (
                    <tr
                      key={lead.id}
                      className={index % 2 === 0 ? "bg-background" : "bg-muted/20"}
                    >
                      <td className="px-4 py-3 font-medium">#{lead.id}</td>
                      <td className="px-4 py-3 text-xs">
                        <div className="font-semibold">{lead.name}</div>
                        <div className="text-muted-foreground">
                          {lead.businessName || "--"}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-xs">
                        <div>{lead.telephone || "--"}</div>
                        <div className="text-muted-foreground">{lead.email || "--"}</div>
                      </td>
                      <td className="px-4 py-3 text-xs">
                        <div>{lead.businessType || "--"}</div>
                        <div className="text-muted-foreground">
                          {lead.businessLocation || "--"}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-xs">{lead.hubspotSyncStatus}</td>
                      <td className="px-4 py-3 text-xs text-muted-foreground">
                        {formatDateTime(lead.createdAt)}
                      </td>
                      <td className="px-4 py-3">
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={archivingLeadId === lead.id}
                          onClick={() => requestSetArchived(lead, false)}
                        >
                          {archivingLeadId === lead.id ? "Saving..." : "Unarchive"}
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="text-muted-foreground text-sm">No archived leads found.</div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog
        open={confirmDialogOpen}
        onOpenChange={(open) => {
          setConfirmDialogOpen(open)
          if (!open) {
            setPendingArchiveAction(null)
          }
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              {pendingArchiveAction?.archived ? "Archive Lead" : "Unarchive Lead"}
            </DialogTitle>
            <DialogDescription>
              {pendingArchiveAction
                ? pendingArchiveAction.archived
                  ? `Are you sure you want to archive "${pendingArchiveAction.lead.name}"?`
                  : `Are you sure you want to unarchive "${pendingArchiveAction.lead.name}"?`
                : "Please confirm this action."}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setConfirmDialogOpen(false)
                setPendingArchiveAction(null)
              }}
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={() => {
                if (!pendingArchiveAction) {
                  return
                }
                setConfirmDialogOpen(false)
                void handleSetArchived(
                  pendingArchiveAction.lead,
                  pendingArchiveAction.archived
                )
                setPendingArchiveAction(null)
              }}
            >
              Confirm
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
