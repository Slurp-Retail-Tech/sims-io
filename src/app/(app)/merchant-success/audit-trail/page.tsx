"use client"

import * as React from "react"
import { format } from "date-fns"
import { SquareArrowOutUpRight } from "lucide-react"

import { DateRangePicker, type DateRangeValue } from "@/components/date-range-picker"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Separator } from "@/components/ui/separator"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { formatDateTime, parseDate } from "@/lib/dates"
import { getSessionUser } from "@/lib/session"

type AuditTrailRow = {
  id: string
  ticketId: string
  field: string
  oldValue: string | null
  newValue: string | null
  changedAt: string
  changedBy: string | null
}

type TicketDetail = {
  id: string
  merchantName: string | null
  customerPhone: string | null
  franchiseName: string | null
  outletName: string | null
  fid: string | null
  oid: string | null
  status: string
  hidden: boolean
  category: string | null
  subcategory1: string | null
  subcategory2: string | null
  issueDescription: string | null
  ticketDescription: string | null
  clickupLink: string | null
  clickupTaskId: string | null
  clickupTaskStatus: string | null
  clickupTaskStatusSyncedAt: string | null
  attachments: string[]
  createdAt: string
  updatedAt: string
  closedAt: string | null
  updatedBy: string | null
  msPicUserId: string | null
  msPicName: string | null
  csat?: {
    surveyStatus: string
    tokenPreview: string | null
    createdAt: string | null
    expiresAt: string | null
    usedAt: string | null
  }
}

const perPageOptions = [10, 25, 50, 100]
const statusColorMap: Record<string, { text: string; background: string }> = {
  Open: {
    text: "#b91c1c",
    background: "rgba(185, 28, 28, 0.12)",
  },
  "In Progress": {
    text: "#d97706",
    background: "rgba(217, 119, 6, 0.12)",
  },
  "Pending Customer": {
    text: "#0ea5e9",
    background: "rgba(14, 165, 233, 0.14)",
  },
  Resolved: {
    text: "#047857",
    background: "rgba(4, 120, 87, 0.12)",
  },
}

const historyFieldLabels: Record<string, string> = {
  status: "Status",
  hidden: "Archived",
  merchant_name: "Merchant Name",
  phone_number: "Phone No.",
  fid: "FID",
  oid: "OID",
  franchise_name_resolved: "Franchise",
  outlet_name_resolved: "Outlet",
  issue_type: "Category",
  issue_subcategory1: "Subcategory 1",
  issue_subcategory2: "Subcategory 2",
  issue_description: "Issue Description",
  ticket_description: "Internal Notes",
  ms_pic_user_id: "Assigned MS PIC",
  clickup_task_id: "ClickUp Task ID",
  clickup_link: "ClickUp Task Link",
  clickup_task_status: "ClickUp Status",
  clickup_task_status_synced_at: "ClickUp Status Synced At",
  updated_by: "Updated By",
  closed_at: "Closed At",
  csat_token_generated: "CSAT Link Generated",
  csat_link_shared: "CSAT Link Shared",
  csat_link_shared_at: "CSAT Sent Timestamp",
  csat_whatsapp_sent: "CSAT WhatsApp Sent",
}

function getHistoryFieldLabel(field: string) {
  return historyFieldLabels[field] ?? field
}

function formatHistoryValue(field: string, value: string | null) {
  if (value === null || value === "") {
    return "--"
  }
  if (field === "hidden") {
    if (value === "1" || value.toLowerCase() === "true") {
      return "Yes"
    }
    if (value === "0" || value.toLowerCase() === "false") {
      return "No"
    }
  }
  return value
}

function getPaginationItems(current: number, total: number) {
  if (total <= 7) {
    return Array.from({ length: total }, (_, index) => index + 1)
  }

  if (current <= 3) {
    return [1, 2, 3, 4, "ellipsis", total]
  }

  if (current >= total - 2) {
    return [1, "ellipsis", total - 3, total - 2, total - 1, total]
  }

  return [1, "ellipsis", current - 1, current, current + 1, "ellipsis", total]
}

function getTicketStatusColors(status: string) {
  return (
    statusColorMap[status] ?? {
      text: "#374151",
      background: "rgba(55, 65, 81, 0.12)",
    }
  )
}

function getClickUpStatusColors(status: string | null) {
  const normalized = (status ?? "").trim().toLowerCase()
  if (!normalized || normalized === "unknown") {
    return { text: "#374151", background: "rgba(55, 65, 81, 0.12)" }
  }
  if (
    normalized.includes("done") ||
    normalized.includes("closed") ||
    normalized.includes("complete") ||
    normalized.includes("resolved")
  ) {
    return { text: "#047857", background: "rgba(4, 120, 87, 0.12)" }
  }
  if (
    normalized.includes("progress") ||
    normalized.includes("review") ||
    normalized.includes("working")
  ) {
    return { text: "#d97706", background: "rgba(217, 119, 6, 0.12)" }
  }
  if (
    normalized.includes("todo") ||
    normalized.includes("open") ||
    normalized.includes("backlog")
  ) {
    return { text: "#0ea5e9", background: "rgba(14, 165, 233, 0.14)" }
  }
  if (normalized.includes("blocked") || normalized.includes("stuck")) {
    return { text: "#b91c1c", background: "rgba(185, 28, 28, 0.12)" }
  }
  return { text: "#374151", background: "rgba(55, 65, 81, 0.12)" }
}

function toProperCase(value: string | null) {
  if (!value) {
    return "Unknown"
  }
  return value
    .trim()
    .replace(/[_-]+/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(" ")
}

function getCloseDuration(createdAt: string, resolvedAt: string | null) {
  if (!resolvedAt) {
    return null
  }
  const created = parseDate(createdAt)
  const resolved = parseDate(resolvedAt)
  if (!created || !resolved) {
    return null
  }
  const diffMs = resolved.getTime() - created.getTime()
  if (diffMs < 0) {
    return null
  }
  const totalMinutes = Math.floor(diffMs / (1000 * 60))
  const days = Math.floor(totalMinutes / (60 * 24))
  const hours = Math.floor((totalMinutes % (60 * 24)) / 60)
  const minutes = totalMinutes % 60
  const parts: string[] = []
  if (days > 0) {
    parts.push(`${days}d`)
  }
  if (hours > 0 || days > 0) {
    parts.push(`${hours}h`)
  }
  parts.push(`${minutes}m`)
  return parts.join(" ")
}

export default function MerchantSuccessAuditTrailPage() {
  const [rows, setRows] = React.useState<AuditTrailRow[]>([])
  const [loading, setLoading] = React.useState(true)
  const [ticketIdInput, setTicketIdInput] = React.useState("")
  const [ticketIdQuery, setTicketIdQuery] = React.useState("")
  const [dateRange, setDateRange] = React.useState<DateRangeValue>({
    start: null,
    end: null,
  })
  const [page, setPage] = React.useState(1)
  const [perPage, setPerPage] = React.useState(25)
  const [total, setTotal] = React.useState(0)
  const [dialogOpen, setDialogOpen] = React.useState(false)
  const [detailLoading, setDetailLoading] = React.useState(false)
  const [selectedTicketId, setSelectedTicketId] = React.useState<string | null>(null)
  const [ticketDetail, setTicketDetail] = React.useState<TicketDetail | null>(null)
  const [detailError, setDetailError] = React.useState<string | null>(null)

  const totalPages = Math.max(1, Math.ceil(total / perPage))
  const paginationItems = React.useMemo(
    () => getPaginationItems(page, totalPages),
    [page, totalPages]
  )
  const startDate = dateRange.start ? format(dateRange.start, "yyyy-MM-dd") : null
  const endDate = dateRange.end ? format(dateRange.end, "yyyy-MM-dd") : null

  React.useEffect(() => {
    setPage(1)
  }, [ticketIdQuery, startDate, endDate, perPage])

  React.useEffect(() => {
    const handle = setTimeout(() => {
      setTicketIdQuery(ticketIdInput.trim())
    }, 300)
    return () => clearTimeout(handle)
  }, [ticketIdInput])

  const loadHistory = React.useCallback(async () => {
    const user = getSessionUser()
    if (!user?.id) {
      setLoading(false)
      return
    }

    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (ticketIdQuery) {
        params.set("ticket_id", ticketIdQuery)
      }
      if (startDate) {
        params.set("start_date", startDate)
      }
      if (endDate) {
        params.set("end_date", endDate)
      }
      params.set("page", String(page))
      params.set("per_page", String(perPage))

      const response = await fetch(`/api/tickets/history?${params.toString()}`, {
      })
      if (!response.ok) {
        throw new Error("Unable to load audit history.")
      }

      const data = (await response.json()) as {
        history: AuditTrailRow[]
        total: number
      }
      setRows(data.history ?? [])
      setTotal(data.total ?? 0)
    } catch (error) {
      console.error(error)
      setRows([])
      setTotal(0)
    } finally {
      setLoading(false)
    }
  }, [endDate, page, perPage, startDate, ticketIdQuery])

  React.useEffect(() => {
    void loadHistory()
  }, [loadHistory])

  const handleClear = React.useCallback(() => {
    setTicketIdInput("")
    setTicketIdQuery("")
    setDateRange({ start: null, end: null })
    setPage(1)
  }, [])

  const resultsLabel = `${total} change${total === 1 ? "" : "s"}`
  const selectedStatusColors = getTicketStatusColors(ticketDetail?.status ?? "Open")
  const selectedResolvedAt =
    ticketDetail?.status === "Resolved"
      ? ticketDetail.closedAt || ticketDetail.updatedAt
      : null
  const handlePageChange = React.useCallback(
    (nextPage: number) => {
      if (nextPage < 1 || nextPage > totalPages) {
        return
      }
      setPage(nextPage)
    },
    [totalPages]
  )

  const openTicketModal = React.useCallback(async (ticketId: string) => {
    const user = getSessionUser()
    if (!user?.id) {
      return
    }
    setSelectedTicketId(ticketId)
    setDialogOpen(true)
    setDetailLoading(true)
    setTicketDetail(null)
    setDetailError(null)
    try {
      const response = await fetch(`/api/tickets/${ticketId}`, {
      })
      if (!response.ok) {
        throw new Error("Unable to load ticket details.")
      }
      const data = (await response.json()) as { ticket: TicketDetail }
      setTicketDetail(data.ticket)
    } catch (error) {
      console.error(error)
      setDetailError("Unable to load ticket details.")
    } finally {
      setDetailLoading(false)
    }
  }, [])

  return (
    <>
      <Card>
      <CardHeader className="gap-4">
        <div className="space-y-1">
          <CardTitle>Audit Trail</CardTitle>
          <p className="text-muted-foreground text-sm">
            Track all field-level ticket updates across Merchant Success.
          </p>
        </div>
        <div className="flex flex-col gap-3 md:flex-row md:items-center">
          <Input
            value={ticketIdInput}
            onChange={(event) => setTicketIdInput(event.target.value)}
            placeholder="Search ticket ID"
            className="md:w-[220px]"
          />
          <DateRangePicker
            value={dateRange}
            onChange={setDateRange}
            placeholder="Filter by change date"
            className="w-full md:w-[260px]"
          />
          <div className="flex gap-2">
            <Button variant="outline" onClick={handleClear}>
              Clear
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="text-muted-foreground text-sm">{resultsLabel}</div>

        <div className="overflow-hidden rounded-xl border">
          <div className="max-h-[600px] overflow-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-3 py-2">Changed At</th>
                  <th className="px-3 py-2">Ticket ID</th>
                  <th className="px-3 py-2">Field</th>
                  <th className="px-3 py-2">Old Value</th>
                  <th className="px-3 py-2">New Value</th>
                  <th className="px-3 py-2">Changed By</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={6} className="px-3 py-8 text-center text-muted-foreground">
                      Loading audit trail...
                    </td>
                  </tr>
                ) : rows.length ? (
                  rows.map((row) => (
                    <tr key={row.id} className="border-t align-top">
                      <td className="px-3 py-2">{formatDateTime(row.changedAt)}</td>
                      <td className="px-3 py-2 font-medium">
                        <button
                          type="button"
                          onClick={() => void openTicketModal(row.ticketId)}
                          className="text-primary underline-offset-4 hover:underline"
                        >
                          #{row.ticketId}
                        </button>
                      </td>
                      <td className="px-3 py-2">{getHistoryFieldLabel(row.field)}</td>
                      <td className="max-w-[280px] px-3 py-2 break-words whitespace-pre-wrap">
                        {formatHistoryValue(row.field, row.oldValue)}
                      </td>
                      <td className="max-w-[280px] px-3 py-2 break-words whitespace-pre-wrap">
                        {formatHistoryValue(row.field, row.newValue)}
                      </td>
                      <td className="px-3 py-2">{row.changedBy ?? "--"}</td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={6} className="px-3 py-8 text-center text-muted-foreground">
                      No audit records match the selected filters.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {totalPages > 1 ? (
          <div className="flex flex-col gap-3 pt-2">
            <Separator />
            <div className="grid w-full grid-cols-1 gap-3 text-xs text-muted-foreground md:grid-cols-[1fr_auto_1fr] md:items-center">
              <div className="flex items-center gap-3">
                <Select
                  value={String(perPage)}
                  onValueChange={(value) => setPerPage(Number(value))}
                >
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
              <Pagination className="md:justify-self-center">
                <PaginationContent>
                  <PaginationItem>
                    <PaginationPrevious
                      href="#"
                      aria-disabled={page === 1}
                      tabIndex={page === 1 ? -1 : undefined}
                      className={
                        page === 1 ? "pointer-events-none opacity-50" : undefined
                      }
                      onClick={(event) => {
                        event.preventDefault()
                        handlePageChange(page - 1)
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
                            handlePageChange(item as number)
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
                        page === totalPages
                          ? "pointer-events-none opacity-50"
                          : undefined
                      }
                      onClick={(event) => {
                        event.preventDefault()
                        handlePageChange(page + 1)
                      }}
                    />
                  </PaginationItem>
                </PaginationContent>
              </Pagination>
              <div className="hidden md:block" />
            </div>
          </div>
        ) : null}
      </CardContent>
      </Card>
      <Dialog
        open={dialogOpen}
        onOpenChange={(next) => {
          setDialogOpen(next)
          if (!next) {
            setSelectedTicketId(null)
            setTicketDetail(null)
            setDetailError(null)
          }
        }}
      >
        <DialogContent className="max-h-[90vh] w-[96vw] md:w-[60vw] max-w-[1200px] overflow-y-auto p-0">
          <div className="bg-background sticky top-0 z-20 border-b px-6 py-4">
            <DialogHeader>
              <DialogTitle>Ticket #{ticketDetail?.id ?? selectedTicketId ?? "--"}</DialogTitle>
              <DialogDescription>
                {ticketDetail
                  ? `Created ${formatDateTime(ticketDetail.createdAt)} · Updated ${formatDateTime(
                      ticketDetail.updatedAt
                    )} · Updated by ${ticketDetail.updatedBy ?? "--"}`
                  : "Loading ticket details..."}
              </DialogDescription>
            </DialogHeader>
          </div>

          <div className="px-6 py-4">
            {detailLoading || !ticketDetail ? (
              <div className="text-muted-foreground text-sm">Loading ticket details...</div>
            ) : detailError ? (
              <div className="text-destructive text-sm">{detailError}</div>
            ) : (
              <div className="space-y-4 [&_[data-slot=card]]:gap-3 [&_[data-slot=card-header]]:gap-1">
                <div className="flex flex-wrap items-center gap-2">
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span
                        className="inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-semibold"
                        style={{
                          color: selectedStatusColors.text,
                          backgroundColor: selectedStatusColors.background,
                        }}
                      >
                        <span
                          className="size-2 rounded-full"
                          style={{ backgroundColor: selectedStatusColors.text }}
                        />
                        {ticketDetail.status}
                      </span>
                    </TooltipTrigger>
                    {ticketDetail.status === "Resolved" ? (
                      <TooltipContent>
                        <div>
                          Resolved: {selectedResolvedAt ? formatDateTime(selectedResolvedAt) : "--"}
                        </div>
                        <div>
                          Duration:{" "}
                          {getCloseDuration(ticketDetail.createdAt, selectedResolvedAt) ?? "--"}
                        </div>
                      </TooltipContent>
                    ) : null}
                  </Tooltip>
                  {ticketDetail.attachments.map((url, index) => (
                    <a
                      key={`${url}-${index}`}
                      href={url}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 rounded-full border px-3 py-1 text-xs hover:bg-muted/60"
                    >
                      Attachment {index + 1}
                      <SquareArrowOutUpRight className="size-3" aria-hidden="true" />
                    </a>
                  ))}
                  {ticketDetail.clickupLink ? (
                    <a
                      href={ticketDetail.clickupLink}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 rounded-full border px-3 py-1 text-xs hover:bg-muted/60"
                    >
                      ClickUp Task
                      <SquareArrowOutUpRight className="size-3" aria-hidden="true" />
                    </a>
                  ) : null}
                  <span className="inline-flex items-center rounded-full border px-3 py-1 text-xs">
                    Assigned MS PIC: {ticketDetail.msPicName ?? "--"}
                  </span>
                </div>

                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm">Contact Information</CardTitle>
                    <CardDescription>Merchant and outlet contact details.</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-2 text-sm">
                    <div className="grid gap-2 md:grid-cols-2">
                      <div>
                        <div className="text-muted-foreground mb-1 text-xs">Franchise</div>
                        <div className="bg-muted/40 rounded-md border px-3 py-2 text-sm">
                          {ticketDetail.franchiseName ?? "--"}
                        </div>
                      </div>
                      <div>
                        <div className="text-muted-foreground mb-1 text-xs">Outlet</div>
                        <div className="bg-muted/40 rounded-md border px-3 py-2 text-sm">
                          {ticketDetail.outletName ?? "--"}
                        </div>
                      </div>
                    </div>
                    <div className="grid gap-2 md:grid-cols-2">
                      <div>
                        <div className="text-muted-foreground mb-1 text-xs">Merchant Name</div>
                        <div className="bg-muted/40 rounded-md border px-3 py-2 text-sm">
                          {ticketDetail.merchantName ?? "--"}
                        </div>
                      </div>
                      <div>
                        <div className="text-muted-foreground mb-1 text-xs">Phone No.</div>
                        <div className="bg-muted/40 rounded-md border px-3 py-2 text-sm">
                          {ticketDetail.customerPhone ?? "--"}
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm">CSAT Survey</CardTitle>
                    <CardDescription>Survey token and sharing actions.</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-2 text-sm">
                    <div>Status: {ticketDetail.csat?.surveyStatus ?? "--"}</div>
                    <div>Token: {ticketDetail.csat?.tokenPreview ?? "--"}</div>
                    <div>Created: {ticketDetail.csat?.createdAt ? formatDateTime(ticketDetail.csat.createdAt) : "--"}</div>
                    <div>Expires: {ticketDetail.csat?.expiresAt ? formatDateTime(ticketDetail.csat.expiresAt) : "--"}</div>
                    <div>Used: {ticketDetail.csat?.usedAt ? formatDateTime(ticketDetail.csat.usedAt) : "--"}</div>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm">Ticket Metadata</CardTitle>
                    <CardDescription>Identifiers, assignment, and status.</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-3 text-sm">
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <div className="text-muted-foreground mb-1 text-xs">FID</div>
                        <div className="bg-muted/40 rounded-md border px-3 py-2 text-sm">
                          {ticketDetail.fid ?? "--"}
                        </div>
                      </div>
                      <div>
                        <div className="text-muted-foreground mb-1 text-xs">OID</div>
                        <div className="bg-muted/40 rounded-md border px-3 py-2 text-sm">
                          {ticketDetail.oid ?? "--"}
                        </div>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <div className="text-muted-foreground mb-1 text-xs">Assigned MS PIC</div>
                        <div className="bg-muted/40 rounded-md border px-3 py-2 text-sm">
                          {ticketDetail.msPicName ?? "--"}
                        </div>
                      </div>
                      <div>
                        <div className="text-muted-foreground mb-1 text-xs">Status</div>
                        <div className="bg-muted/40 rounded-md border px-3 py-2 text-sm">
                          {ticketDetail.status}
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm">ClickUp Integration</CardTitle>
                    <CardDescription>Linked task controls and sync actions.</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-2 text-sm">
                    <div>Current Task: {ticketDetail.clickupTaskId ?? "--"}</div>
                    <div className="flex items-center gap-2">
                      <span>ClickUp Status:</span>
                      {ticketDetail.clickupTaskId || ticketDetail.clickupLink ? (
                        <span
                          className="inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-semibold"
                          style={{
                            color: getClickUpStatusColors(ticketDetail.clickupTaskStatus).text,
                            backgroundColor: getClickUpStatusColors(ticketDetail.clickupTaskStatus)
                              .background,
                          }}
                        >
                          {toProperCase(ticketDetail.clickupTaskStatus)}
                        </span>
                      ) : (
                        <span>--</span>
                      )}
                    </div>
                    <div className="text-muted-foreground text-xs">
                      Last synced:{" "}
                      {ticketDetail.clickupTaskStatusSyncedAt
                        ? formatDateTime(ticketDetail.clickupTaskStatusSyncedAt)
                        : "--"}
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm">Issue Details</CardTitle>
                    <CardDescription>Category and issue breakdown.</CardDescription>
                  </CardHeader>
                  <CardContent className="grid gap-3 text-sm md:grid-cols-2">
                    <div>
                      <div className="text-muted-foreground mb-1 text-xs">Category</div>
                      <div className="bg-muted/40 rounded-md border px-3 py-2 text-sm">
                        {ticketDetail.category ?? "--"}
                      </div>
                    </div>
                    <div>
                      <div className="text-muted-foreground mb-1 text-xs">Subcategory 1</div>
                      <div className="bg-muted/40 rounded-md border px-3 py-2 text-sm">
                        {ticketDetail.subcategory1 ?? "--"}
                      </div>
                    </div>
                    <div>
                      <div className="text-muted-foreground mb-1 text-xs">Subcategory 2</div>
                      <div className="bg-muted/40 rounded-md border px-3 py-2 text-sm">
                        {ticketDetail.subcategory2 ?? "--"}
                      </div>
                    </div>
                    <div>
                      <div className="text-muted-foreground mb-1 text-xs">Archived</div>
                      <div className="bg-muted/40 rounded-md border px-3 py-2 text-sm">
                        {ticketDetail.hidden ? "Yes" : "No"}
                      </div>
                    </div>
                    <div className="md:col-span-2">
                      <div className="text-muted-foreground mb-1 text-xs">Issue Description</div>
                      <div className="bg-muted/40 min-h-[88px] rounded-md border px-3 py-2 text-sm whitespace-pre-wrap">
                        {ticketDetail.issueDescription ?? "--"}
                      </div>
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm">Internal Notes</CardTitle>
                    <CardDescription>Internal context and follow-up notes.</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="bg-muted/40 min-h-[100px] rounded-md border px-3 py-2 text-sm whitespace-pre-wrap">
                      {ticketDetail.ticketDescription ?? "--"}
                    </div>
                  </CardContent>
                </Card>
              </div>
            )}
          </div>
          <div className="bg-background sticky bottom-0 z-20 border-t px-6 py-4">
            <DialogFooter className="flex-wrap justify-end gap-2 sm:flex-row">
              <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>
                Close
              </Button>
            </DialogFooter>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
