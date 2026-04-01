"use client"

import * as React from "react"
import { format } from "date-fns"
import {
  ChevronLeft,
  ChevronRight,
  FileSpreadsheet,
  FileText,
  Loader2,
  SquareArrowOutUpRight,
} from "lucide-react"
import { useRouter, useSearchParams } from "next/navigation"

import { formatDateTime, parseDate } from "@/lib/dates"
import { getSessionUser } from "@/lib/session"
import { DateRangePicker, type DateRangeValue } from "@/components/date-range-picker"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { useToast } from "@/components/toast-provider"

type TicketRow = {
  id: string
  customerName: string | null
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
  clickupLink: string | null
  clickupTaskId: string | null
  clickupTaskStatus: string | null
  resolvedAt: string | null
  createdAt: string
  lastMessageAt: string | null
  msAgentName: string | null
}

type AgentOption = {
  id: string
  name: string
  email: string
}

type TicketCategoryNode = {
  id: string
  name: string
  sortOrder: number
  subcategories: TicketCategoryNode[]
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
  openedAt: string | null
  merchantSentiment: string | null
  attachments: string[]
  createdAt: string
  updatedAt: string
  closedAt: string | null
  updatedBy: string | null
  msPicUserId: string | null
  msPicName: string | null
  csat: {
    surveyStatus: string
    token: string | null
    tokenPreview: string | null
    createdAt: string | null
    expiresAt: string | null
    usedAt: string | null
    response: {
      supportScore: string | null
      supportComment: string | null
      productScore: string | null
      productFeedback: string | null
      submittedAt: string
    } | null
  }
}

type TicketHistoryRow = {
  id: string
  field: string
  oldValue: string | null
  newValue: string | null
  changedAt: string
  changedBy: string | null
}

const statusOptions = [
  "Open",
  "In Progress",
  "Pending Customer",
  "Resolved",
]

const sentimentOptions = [
  "Angry 🔥",
  "Frustrated 😤",
  "Confused 🤔",
  "Urgent 🚨",
  "Satisfied 😄",
]

const formatStatusLabel = (value: string) => {
  return value
}

const perPageOptions = [10, 25, 50, 100]
const dateFilterCookie = "tickets_date_filter"
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

function getCsatStatusColors(status: string | null) {
  const normalized = (status ?? "").trim().toLowerCase()
  if (normalized === "responded") {
    return { text: "#047857", background: "rgba(4, 120, 87, 0.12)" }
  }
  if (normalized === "send") {
    return { text: "#0ea5e9", background: "rgba(14, 165, 233, 0.14)" }
  }
  if (normalized === "generated") {
    return { text: "#4338ca", background: "rgba(67, 56, 202, 0.12)" }
  }
  if (normalized === "expired") {
    return { text: "#b91c1c", background: "rgba(185, 28, 28, 0.12)" }
  }
  if (normalized === "used") {
    return { text: "#d97706", background: "rgba(217, 119, 6, 0.12)" }
  }
  return { text: "#374151", background: "rgba(55, 65, 81, 0.12)" }
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
  opened_at: "Opened At",
  merchant_sentiment: "Merchant Sentiment",
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

function getTicketStatusColors(status: string) {
  return (
    statusColorMap[status] ?? {
      text: "#374151",
      background: "rgba(55, 65, 81, 0.12)",
    }
  )
}

function formatHistoryField(field: string) {
  return historyFieldLabels[field] ?? field
}

const historyDateFields = new Set([
  "clickup_task_status_synced_at",
  "closed_at",
  "opened_at",
  "csat_link_shared_at",
])

function formatHistoryValue(field: string, value: string | null) {
  if (!value) {
    return "--"
  }
  if (!historyDateFields.has(field)) {
    return value
  }
  return parseDate(value) ? formatDateTime(value) : value
}

function getChatUrl(phoneNumber: string | null) {
  if (!phoneNumber) {
    return null
  }
  const digits = phoneNumber.replace(/\D/g, "")
  return digits ? `https://wa.me/${digits}` : null
}

function getTicketChatMessage(ticket: TicketRow) {
  const merchantName = ticket.customerName ?? "Merchant"
  const issueLine =
    [ticket.category, ticket.subcategory1, ticket.subcategory2]
      .filter((part): part is string => Boolean(part && part.trim()))
      .join(" · ") || "--"
  const assignee = ticket.msAgentName ?? "Assign MS PIC"

  return [
    `*Ticket ID:* #${ticket.id}`,
    "",
    `Hi *${merchantName}*,`,
    "",
    "Thanks for your patience. I’m looking into your issue now:",
    issueLine,
    "",
    "If you have any extra details or questions, just reply here.",
    "",
    "Best regards,",
    assignee,
    "Slurp Merchant Success Team",
  ].join("\n")
}

function getCsatUrl(token: string | null) {
  if (!token || typeof window === "undefined") {
    return null
  }
  return `${window.location.origin}/csat/${encodeURIComponent(token)}`
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

function parseCookieValue(value: string | null): DateRangeValue {
  if (!value) {
    return { start: null, end: null }
  }

  try {
    const decoded = decodeURIComponent(value)
    const parsed = JSON.parse(decoded) as { start?: string; end?: string }
    const start = parseDateInput(parsed.start ?? null)
    const end = parseDateInput(parsed.end ?? null)
    return { start, end }
  } catch {
    return { start: null, end: null }
  }
}

function parseDateInput(value: string | null) {
  if (!value) {
    return null
  }
  const [year, month, day] = value.split("-").map((part) => Number(part))
  if (!year || !month || !day) {
    return null
  }
  const date = new Date(year, month - 1, day)
  return Number.isNaN(date.valueOf()) ? null : date
}

function getCookieValue(name: string) {
  if (typeof document === "undefined") {
    return null
  }
  const prefix = `${name}=`
  const value = document.cookie
    .split("; ")
    .find((cookie) => cookie.startsWith(prefix))
  return value ? value.slice(prefix.length) : null
}

function setCookieValue(name: string, value: string | null) {
  if (typeof document === "undefined") {
    return
  }
  if (!value) {
    document.cookie = `${name}=; Max-Age=0; Path=/`
    return
  }
  const maxAgeSeconds = 60 * 60 * 12
  document.cookie = `${name}=${value}; Max-Age=${maxAgeSeconds}; Path=/`
}

export default function MerchantSuccessTicketsPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const sessionUser = React.useMemo(() => getSessionUser(), [])
  const { showToast } = useToast()
  const canArchive = sessionUser?.role === "Admin" || sessionUser?.role === "Super Admin"
  const clickupEnabled = process.env.NEXT_PUBLIC_CLICKUP_ENABLED !== "false"
  const [tickets, setTickets] = React.useState<TicketRow[]>([])
  const [loading, setLoading] = React.useState(true)
  const [searchInput, setSearchInput] = React.useState("")
  const [searchQuery, setSearchQuery] = React.useState("")
  const [statusFilter, setStatusFilter] = React.useState("all")
  const [archiveFilter, setArchiveFilter] = React.useState("active")
  const [clickupFilter, setClickupFilter] = React.useState("all")
  const [dateRange, setDateRange] = React.useState<DateRangeValue>(() =>
    parseCookieValue(getCookieValue(dateFilterCookie))
  )
  const [page, setPage] = React.useState(1)
  const [perPage, setPerPage] = React.useState(25)
  const [total, setTotal] = React.useState(0)
  const [exportingFormat, setExportingFormat] = React.useState<null | "csv" | "xlsx">(
    null
  )
  const [agents, setAgents] = React.useState<AgentOption[]>([])
  const [categoryTree, setCategoryTree] = React.useState<TicketCategoryNode[]>([])
  const [dialogOpen, setDialogOpen] = React.useState(false)
  const [detailLoading, setDetailLoading] = React.useState(false)
  const [detailSaving, setDetailSaving] = React.useState(false)
  const [selectedTicketId, setSelectedTicketId] = React.useState<string | null>(null)
  const [ticketDetail, setTicketDetail] = React.useState<TicketDetail | null>(null)
  const [ticketDraft, setTicketDraft] = React.useState<TicketDetail | null>(null)
  const [historyRows, setHistoryRows] = React.useState<TicketHistoryRow[]>([])
  const [historyLoading, setHistoryLoading] = React.useState(false)
  const [historyDialogOpen, setHistoryDialogOpen] = React.useState(false)
  const [attendingTicketId, setAttendingTicketId] = React.useState<string | null>(null)
  const [modalInlineError, setModalInlineError] = React.useState<string | null>(null)
  const [errorDialogMessage, setErrorDialogMessage] = React.useState<string | null>(null)
  const [linkDialogOpen, setLinkDialogOpen] = React.useState(false)
  const [linkTaskUrlInput, setLinkTaskUrlInput] = React.useState("")
  const [clickupActionPending, setClickupActionPending] = React.useState(false)
  const [queryModalOpenedTicketId, setQueryModalOpenedTicketId] = React.useState<
    string | null
  >(null)

  const { startDate, endDate } = React.useMemo(() => {
    if (!dateRange.start) {
      return { startDate: "", endDate: "" }
    }
    const start = format(dateRange.start, "yyyy-MM-dd")
    const end = dateRange.end ? format(dateRange.end, "yyyy-MM-dd") : start
    return { startDate: start, endDate: end }
  }, [dateRange.end, dateRange.start])

  const shiftDateFilter = React.useCallback(
    (direction: "back" | "forward") => {
      if (!dateRange.start) {
        return
      }
      const today = new Date()
      today.setHours(0, 0, 0, 0)

      const start = new Date(dateRange.start)
      start.setHours(0, 0, 0, 0)
      const hasEnd = Boolean(dateRange.end)

      if (!hasEnd) {
        const next = new Date(start)
        next.setDate(next.getDate() + (direction === "back" ? -1 : 1))
        if (next > today) {
          return
        }
        setDateRange({ start: next, end: null })
        return
      }

      const end = new Date(dateRange.end as Date)
      end.setHours(0, 0, 0, 0)
      const span =
        Math.floor((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) + 1
      const delta = direction === "back" ? -span : span

      const nextStart = new Date(start)
      const nextEnd = new Date(end)
      nextStart.setDate(nextStart.getDate() + delta)
      nextEnd.setDate(nextEnd.getDate() + delta)

      if (nextEnd > today) {
        const clampedEnd = new Date(today)
        const clampedStart = new Date(clampedEnd)
        clampedStart.setDate(clampedStart.getDate() - (span - 1))
        setDateRange({ start: clampedStart, end: clampedEnd })
        return
      }

      setDateRange({ start: nextStart, end: nextEnd })
    },
    [dateRange.end, dateRange.start]
  )

  const loadAgents = React.useCallback(async () => {
    const user = getSessionUser()
    if (!user?.id) {
      return
    }
    try {
      const response = await fetch("/api/users/agents")
      if (!response.ok) {
        throw new Error("Unable to load agents.")
      }
      const data = (await response.json()) as { users: AgentOption[] }
      setAgents(data.users ?? [])
    } catch (error) {
      console.error(error)
    }
  }, [])

  React.useEffect(() => {
    void loadAgents()
  }, [loadAgents])

  const loadCategories = React.useCallback(async () => {
    const user = getSessionUser()
    if (!user?.id) {
      return
    }
    try {
      const response = await fetch("/api/ticket-categories")
      if (!response.ok) {
        throw new Error("Unable to load ticket categories.")
      }
      const data = (await response.json()) as { categories: TicketCategoryNode[] }
      setCategoryTree(data.categories ?? [])
    } catch (error) {
      console.error(error)
    }
  }, [])

  React.useEffect(() => {
    void loadCategories()
  }, [loadCategories])

  React.useEffect(() => {
    if (!dateRange.start && !dateRange.end) {
      setCookieValue(dateFilterCookie, null)
      return
    }
    const payload = encodeURIComponent(
      JSON.stringify({
        start: dateRange.start ? format(dateRange.start, "yyyy-MM-dd") : null,
        end: dateRange.end ? format(dateRange.end, "yyyy-MM-dd") : null,
      })
    )
    setCookieValue(dateFilterCookie, payload)
  }, [dateRange.end, dateRange.start])

  const totalPages = Math.max(1, Math.ceil(total / perPage))
  const paginationItems = React.useMemo(
    () => getPaginationItems(page, totalPages),
    [page, totalPages]
  )
  const resultsLabel = `${total} result${total === 1 ? "" : "s"}`

  React.useEffect(() => {
    const handle = setTimeout(() => {
      setSearchQuery(searchInput.trim())
    }, 300)
    return () => clearTimeout(handle)
  }, [searchInput])

  React.useEffect(() => {
    setPage(1)
  }, [searchQuery, statusFilter, archiveFilter, clickupFilter, startDate, endDate, perPage])

  const buildFilterParams = React.useCallback(() => {
    const params = new URLSearchParams()
    if (searchQuery) {
      params.set("q", searchQuery)
    }
    if (statusFilter && statusFilter !== "all") {
      params.set("status", statusFilter)
    }
    if (archiveFilter && archiveFilter !== "all") {
      params.set("archive", archiveFilter)
    }
    if (clickupFilter && clickupFilter !== "all") {
      params.set("clickup", clickupFilter)
    }
    if (startDate) {
      params.set("start_date", startDate)
    }
    if (endDate) {
      params.set("end_date", endDate)
    }
    return params
  }, [archiveFilter, clickupFilter, endDate, searchQuery, startDate, statusFilter])

  const loadTickets = React.useCallback(async () => {
    const user = getSessionUser()
    if (!user?.id) {
      setLoading(false)
      return
    }
    setLoading(true)
    try {
      const params = buildFilterParams()
      params.set("page", String(page))
      params.set("per_page", String(perPage))

      const response = await fetch(`/api/tickets?${params.toString()}`)
      if (!response.ok) {
        throw new Error("Unable to load tickets.")
      }
      const data = (await response.json()) as {
        tickets: TicketRow[]
        total: number
      }
      setTickets(data.tickets ?? [])
      setTotal(data.total ?? 0)
    } catch (error) {
      console.error(error)
    } finally {
      setLoading(false)
    }
  }, [buildFilterParams, page, perPage])

  const handleExport = React.useCallback(
    async (format: "csv" | "xlsx") => {
      const user = getSessionUser()
      if (!user?.id || exportingFormat) {
        return
      }
      setExportingFormat(format)
      try {
        const params = buildFilterParams()
        params.set("format", format)
        const response = await fetch(`/api/tickets/export?${params.toString()}`)
        if (!response.ok) {
          throw new Error("Unable to export tickets.")
        }

        const blob = await response.blob()
        const disposition = response.headers.get("content-disposition")
        const match = disposition?.match(/filename="([^"]+)"/i)
        const fallback = `tickets-export.${format}`
        const fileName = match?.[1] ?? fallback

        const url = URL.createObjectURL(blob)
        const anchor = document.createElement("a")
        anchor.href = url
        anchor.download = fileName
        document.body.appendChild(anchor)
        anchor.click()
        anchor.remove()
        URL.revokeObjectURL(url)
      } catch (error) {
        console.error(error)
      } finally {
        setExportingFormat(null)
      }
    },
    [buildFilterParams, exportingFormat]
  )

  const loadTicketDetail = React.useCallback(async (ticketId: string) => {
    const user = getSessionUser()
    if (!user?.id) {
      return
    }
    setDetailLoading(true)
    try {
      const response = await fetch(`/api/tickets/${ticketId}`)
      if (!response.ok) {
        throw new Error("Unable to load ticket details.")
      }
      const data = (await response.json()) as { ticket: TicketDetail }
      setTicketDetail(data.ticket)
      setTicketDraft(data.ticket)
    } catch (error) {
      console.error(error)
    } finally {
      setDetailLoading(false)
    }
  }, [])

  const loadTicketHistory = React.useCallback(async (ticketId: string) => {
    const user = getSessionUser()
    if (!user?.id) {
      return
    }
    setHistoryLoading(true)
    try {
      const response = await fetch(`/api/tickets/${ticketId}/history`)
      if (!response.ok) {
        throw new Error("Unable to load ticket history.")
      }
      const data = (await response.json()) as { history: TicketHistoryRow[] }
      setHistoryRows(data.history ?? [])
    } catch (error) {
      console.error(error)
    } finally {
      setHistoryLoading(false)
    }
  }, [])

  const openTicketModal = React.useCallback(
    async (ticketId: string) => {
      setSelectedTicketId(ticketId)
      setDialogOpen(true)
      setTicketDetail(null)
      setTicketDraft(null)
      setHistoryDialogOpen(false)
      setHistoryRows([])
      setModalInlineError(null)
      setErrorDialogMessage(null)
      setLinkDialogOpen(false)
      setClickupActionPending(false)
      await loadTicketDetail(ticketId)
    },
    [loadTicketDetail]
  )

  const isDraftDirty = React.useMemo(() => {
    if (!ticketDetail || !ticketDraft) {
      return false
    }
    return JSON.stringify(ticketDetail) !== JSON.stringify(ticketDraft)
  }, [ticketDetail, ticketDraft])

  const handleSaveTicket = React.useCallback(async () => {
    if (!selectedTicketId || !ticketDraft) {
      return
    }
    const user = getSessionUser()
    if (!user?.id) {
      return
    }
    setModalInlineError(null)
    setDetailSaving(true)
    try {
      const response = await fetch(`/api/tickets/${selectedTicketId}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          status: ticketDraft.status,
          hidden: ticketDraft.hidden,
          merchantName: ticketDraft.merchantName ?? "",
          customerPhone: ticketDraft.customerPhone ?? "",
          fid: ticketDraft.fid ?? "",
          oid: ticketDraft.oid ?? "",
          category: ticketDraft.category ?? "",
          subcategory1: ticketDraft.subcategory1 ?? "",
          subcategory2: ticketDraft.subcategory2 ?? null,
          issueDescription: ticketDraft.issueDescription ?? "",
          ticketDescription: ticketDraft.ticketDescription ?? null,
          msPicUserId: ticketDraft.msPicUserId ?? null,
          clickupTaskId: ticketDraft.clickupTaskId ?? null,
          clickupLink: ticketDraft.clickupLink ?? null,
          clickupTaskStatus: ticketDraft.clickupTaskStatus ?? null,
          clickupTaskStatusSyncedAt:
            ticketDraft.clickupTaskStatusSyncedAt ?? null,
          openedAt: ticketDraft.openedAt ?? null,
          merchantSentiment: ticketDraft.merchantSentiment ?? null,
        }),
      })
      if (!response.ok) {
        throw new Error("Unable to save ticket.")
      }
      showToast("Ticket updated.")
      await loadTickets()
      setDialogOpen(false)
    } catch (error) {
      console.error(error)
      setModalInlineError("Unable to save ticket. Please review and try again.")
      setErrorDialogMessage("Unable to save ticket changes.")
    } finally {
      setDetailSaving(false)
    }
  }, [
    loadTickets,
    selectedTicketId,
    showToast,
    ticketDraft,
  ])

  React.useEffect(() => {
    void loadTickets()
  }, [loadTickets])

  React.useEffect(() => {
    const ticketIdFromQuery = searchParams.get("ticket_id")?.trim()
    if (!ticketIdFromQuery) {
      return
    }
    if (queryModalOpenedTicketId === ticketIdFromQuery) {
      return
    }
    setQueryModalOpenedTicketId(ticketIdFromQuery)
    void openTicketModal(ticketIdFromQuery)
  }, [openTicketModal, queryModalOpenedTicketId, searchParams])

  const handlePageChange = (nextPage: number) => {
    if (nextPage < 1 || nextPage > totalPages) {
      return
    }
    setPage(nextPage)
  }

  const handleAttendTicket = React.useCallback(
    async (ticketId: string) => {
      if (!sessionUser?.id) {
        return
      }
      setAttendingTicketId(ticketId)
      try {
        const response = await fetch(`/api/tickets/${ticketId}`, {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            msPicUserId: sessionUser.id,
            status: "In Progress",
          }),
        })
        if (!response.ok) {
          throw new Error("Unable to attend ticket.")
        }
        showToast("Ticket assigned to you.")
        await loadTickets()
      } catch (error) {
        console.error(error)
        showToast("Unable to attend ticket.", "error")
      } finally {
        setAttendingTicketId(null)
      }
    },
    [loadTickets, sessionUser?.id, showToast]
  )

  const selectedAgentName =
    agents.find((agent) => agent.id === ticketDraft?.msPicUserId)?.name ??
    ticketDraft?.msPicName ??
    "--"

  const selectedStatusColors = getTicketStatusColors(ticketDraft?.status ?? "Open")
  const selectedResolvedAt =
    ticketDraft?.status === "Resolved"
      ? ticketDraft.closedAt || ticketDraft.updatedAt
      : null

  const csatUrl = getCsatUrl(ticketDraft?.csat.token ?? null)
  const csatActionsEnabled = Boolean(csatUrl) && ["Generated", "Send"].includes(
    ticketDraft?.csat.surveyStatus ?? ""
  )

  const selectedCategoryNode = React.useMemo(() => {
    if (!ticketDraft?.category) {
      return null
    }
    return categoryTree.find((item) => item.name === ticketDraft.category) ?? null
  }, [categoryTree, ticketDraft?.category])

  const subcategory1Options = React.useMemo(
    () => selectedCategoryNode?.subcategories ?? [],
    [selectedCategoryNode]
  )

  const selectedSubcategory1Node = React.useMemo(() => {
    if (!ticketDraft?.subcategory1) {
      return null
    }
    return (
      subcategory1Options.find((item) => item.name === ticketDraft.subcategory1) ??
      null
    )
  }, [subcategory1Options, ticketDraft?.subcategory1])

  const subcategory2Options = React.useMemo(
    () => selectedSubcategory1Node?.subcategories ?? [],
    [selectedSubcategory1Node]
  )

  const handleCopyCsat = async () => {
    if (!csatUrl || !csatActionsEnabled) {
      return
    }
    try {
      await navigator.clipboard.writeText(csatUrl)
      showToast("CSAT link copied.")
    } catch (error) {
      console.error(error)
      showToast("Unable to copy CSAT link.", "error")
    }
  }

  const handleShareCsatLink = async () => {
    if (!ticketDraft?.customerPhone || !csatUrl || !csatActionsEnabled || !selectedTicketId) {
      return
    }
    const waUrl = getChatUrl(ticketDraft.customerPhone)
    if (!waUrl) {
      return
    }
    const user = getSessionUser()
    if (!user?.id) {
      return
    }

    try {
      const response = await fetch(`/api/tickets/${selectedTicketId}/csat/share`, {
        method: "POST",
      })
      if (!response.ok) {
        throw new Error("Unable to track CSAT link share.")
      }
    } catch (error) {
      console.error(error)
      showToast("Unable to track CSAT link send.", "error")
      return
    }

    const text = encodeURIComponent(
      `Hi! Thanks for contacting Merchant Success. We would love to hear your feedback. Please take a moment to share your experience with us. ${csatUrl}`
    )
    setTicketDraft((current) =>
      current
        ? {
            ...current,
            csat: {
              ...current.csat,
              surveyStatus: "Send",
            },
          }
        : current
    )
    window.open(`${waUrl}?text=${text}`, "_blank", "noopener,noreferrer")
    showToast("CSAT link shared.")
  }

  const handleClickUpLink = () => {
    if (!ticketDraft) {
      return
    }
    setLinkTaskUrlInput(ticketDraft.clickupLink ?? "")
    setLinkDialogOpen(true)
  }

  const handleClickUpRemove = () => {
    if (!ticketDraft) {
      return
    }
    setTicketDraft({
      ...ticketDraft,
      clickupTaskId: null,
      clickupLink: null,
      clickupTaskStatus: null,
      clickupTaskStatusSyncedAt: null,
    })
  }

  const handleApplyClickupLink = async () => {
    if (!ticketDraft || !selectedTicketId) {
      return
    }
    const user = getSessionUser()
    if (!user?.id) {
      return
    }
    const normalizedLink = linkTaskUrlInput.trim()
    if (!normalizedLink) {
      setModalInlineError("ClickUp link is required when linking an existing task.")
      return
    }

    const extractedTaskId = normalizedLink.match(/\/t\/([^/?#]+)/)?.[1] ?? null

    setClickupActionPending(true)
    setModalInlineError(null)
    try {
      const linkResponse = await fetch(`/api/tickets/${selectedTicketId}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          clickupTaskId: extractedTaskId,
          clickupLink: normalizedLink || null,
        }),
      })
      if (!linkResponse.ok) {
        const payload = (await linkResponse.json().catch(() => null)) as
          | { error?: string }
          | null
        throw new Error(payload?.error || "Unable to link ClickUp task.")
      }

      const syncResponse = await fetch(`/api/tickets/${selectedTicketId}/clickup/sync`, {
        method: "POST",
      })
      if (!syncResponse.ok) {
        const payload = (await syncResponse.json().catch(() => null)) as
          | { error?: string }
          | null
        throw new Error(payload?.error || "ClickUp task linked but status sync failed.")
      }

      await Promise.all([loadTicketDetail(selectedTicketId), loadTickets()])
      setLinkDialogOpen(false)
      showToast("ClickUp task linked and status synced.")
    } catch (error) {
      console.error(error)
      const message =
        error instanceof Error ? error.message : "Unable to link ClickUp task."
      setModalInlineError(message)
      showToast(message, "error")
    } finally {
      setClickupActionPending(false)
    }
  }

  const handleCreateClickupTaskRequest = () => {
    if (!selectedTicketId || !ticketDraft) {
      return
    }
    const params = new URLSearchParams()
    params.set("open", "create")
    params.set("ticket_id", selectedTicketId)
    if (ticketDraft.fid) {
      params.set("fid", ticketDraft.fid)
    }
    if (ticketDraft.oid) {
      params.set("oid", ticketDraft.oid)
    }
    if (ticketDraft.franchiseName) {
      params.set("franchise_name", ticketDraft.franchiseName)
    }
    if (ticketDraft.outletName) {
      params.set("outlet_name", ticketDraft.outletName)
    }
    if (ticketDraft.msPicName) {
      params.set("ms_pic", ticketDraft.msPicName)
    }
    if (ticketDraft.category) {
      params.set("product", ticketDraft.category)
    }
    if (ticketDraft.issueDescription) {
      params.set("description", ticketDraft.issueDescription)
    }
    const titleParts = [
      `Ticket #${selectedTicketId}`,
      ticketDraft.category,
      ticketDraft.outletName,
    ].filter(Boolean)
    if (titleParts.length) {
      params.set("title", titleParts.join(" · "))
    }
    router.push(`/merchant-success/clickup-tasks?${params.toString()}`)
  }

  const handleRefreshClickupStatus = async () => {
    if (!selectedTicketId) {
      return
    }
    const user = getSessionUser()
    if (!user?.id) {
      return
    }
    setClickupActionPending(true)
    try {
      const response = await fetch(`/api/tickets/${selectedTicketId}/clickup/sync`, {
        method: "POST",
      })
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as
          | { error?: string }
          | null
        throw new Error(payload?.error || "Unable to refresh ClickUp status.")
      }
      await Promise.all([loadTicketDetail(selectedTicketId), loadTickets()])
      showToast("ClickUp status refreshed.")
    } catch (error) {
      console.error(error)
      const message =
        error instanceof Error ? error.message : "Unable to refresh ClickUp status."
      setModalInlineError(message)
      showToast(message, "error")
    } finally {
      setClickupActionPending(false)
    }
  }

  const handleArchiveToggle = async () => {
    if (!selectedTicketId || !ticketDraft || !canArchive) {
      return
    }
    const user = getSessionUser()
    if (!user?.id) {
      return
    }
    setDetailSaving(true)
    try {
      const response = await fetch(`/api/tickets/${selectedTicketId}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          hidden: !ticketDraft.hidden,
        }),
      })
      if (!response.ok) {
        throw new Error("Unable to update archive state.")
      }
      showToast(ticketDraft.hidden ? "Ticket unarchived." : "Ticket archived.")
      await loadTickets()
      setDialogOpen(false)
    } catch (error) {
      console.error(error)
      setModalInlineError("Unable to update archive state.")
      setErrorDialogMessage("Unable to archive/unarchive ticket.")
    } finally {
      setDetailSaving(false)
    }
  }

  const handleOpenTicketHistory = React.useCallback(() => {
    if (!selectedTicketId || detailSaving) {
      return
    }

    setHistoryDialogOpen(true)
    void loadTicketHistory(selectedTicketId)
  }, [detailSaving, loadTicketHistory, selectedTicketId])

  const resolveDraftFranchiseOutlet = React.useCallback(async () => {
    if (!ticketDraft) {
      return
    }
    const user = getSessionUser()
    if (!user?.id) {
      return
    }

    let nextFranchise = ticketDraft.franchiseName
    let nextOutlet = ticketDraft.outletName

    try {
      if (ticketDraft.oid?.trim()) {
        const outletResponse = await fetch(
          `/api/merchants/lookup?oid=${encodeURIComponent(ticketDraft.oid.trim())}`
        )
        if (outletResponse.ok) {
          const outletData = (await outletResponse.json()) as {
            merchant?: { name?: string | null }
            outlet?: { name?: string | null }
          }
          nextFranchise = outletData.merchant?.name ?? nextFranchise
          nextOutlet = outletData.outlet?.name ?? nextOutlet
        }
      }

      if (ticketDraft.fid?.trim()) {
        const franchiseResponse = await fetch(
          `/api/merchants/lookup?fid=${encodeURIComponent(ticketDraft.fid.trim())}`
        )
        if (franchiseResponse.ok) {
          const franchiseData = (await franchiseResponse.json()) as {
            merchant?: { name?: string | null }
          }
          nextFranchise = franchiseData.merchant?.name ?? nextFranchise
        }
      }
    } catch (error) {
      console.error(error)
    }

    setTicketDraft((current) =>
      current
        ? {
            ...current,
            franchiseName: nextFranchise ?? null,
            outletName: nextOutlet ?? null,
          }
        : current
    )
  }, [ticketDraft])

  return (
    <div className="animate-in fade-in slide-in-from-bottom-2 flex flex-col gap-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Merchant Success Tickets
          </h1>
          <p className="text-muted-foreground text-sm">
            Review tickets across channels with date and status filters.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm" className="gap-2" disabled={Boolean(exportingFormat)}>
                {exportingFormat ? (
                  <>
                    <Loader2 className="size-4 animate-spin" />
                    Exporting...
                  </>
                ) : (
                  <>Export</>
                )}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => void handleExport("xlsx")}>
                <FileSpreadsheet className="size-4" />
                Export as XLSX
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => void handleExport("csv")}>
                <FileText className="size-4" />
                Export as CSV
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button asChild variant="outline">
            <a href="/supportform" target="_blank" rel="noreferrer">
              Open Support Form
            </a>
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader className="space-y-4">
          <CardTitle className="text-base">Tickets overview</CardTitle>
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
            <div className="flex-1">
              <Input
                placeholder="Search customer, outlet, FID, OID"
                value={searchInput}
                onChange={(event) => setSearchInput(event.target.value)}
              />
            </div>
            <div className="flex flex-wrap gap-3">
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="h-9 w-[170px] text-sm">
                  <SelectValue placeholder="Status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All statuses</SelectItem>
                  {statusOptions.map((status) => (
                    <SelectItem key={status} value={status}>
                      {formatStatusLabel(status)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={archiveFilter} onValueChange={setArchiveFilter}>
                <SelectTrigger className="h-9 w-[140px] text-sm">
                  <SelectValue placeholder="Archive" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All tickets</SelectItem>
                  <SelectItem value="active">Active only</SelectItem>
                  <SelectItem value="archived">Archived only</SelectItem>
                </SelectContent>
              </Select>
              <Select value={clickupFilter} onValueChange={setClickupFilter}>
                <SelectTrigger className="h-9 w-[180px] text-sm">
                  <SelectValue placeholder="ClickUp" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All ClickUp</SelectItem>
                  <SelectItem value="with">With task</SelectItem>
                  <SelectItem value="without">Without task</SelectItem>
                </SelectContent>
              </Select>
              <Button
                type="button"
                variant="outline"
                size="icon-sm"
                onClick={() => shiftDateFilter("back")}
                disabled={!dateRange.start}
                title="Previous date range"
              >
                <ChevronLeft className="size-4" />
              </Button>
              <DateRangePicker
                value={dateRange}
                onChange={setDateRange}
                className="w-[240px]"
              />
              <Button
                type="button"
                variant="outline"
                size="icon-sm"
                onClick={() => shiftDateFilter("forward")}
                disabled={!dateRange.start}
                title="Next date range"
              >
                <ChevronRight className="size-4" />
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {loading ? (
            <div className="text-muted-foreground text-sm">
              Loading tickets...
            </div>
          ) : tickets.length ? (
            <div className="space-y-4">
              <div className="overflow-x-auto rounded-lg border bg-card">
                <div className="flex items-center justify-between border-b px-4 py-3">
                  <div className="text-base font-semibold">Tickets</div>
                  <div className="text-xs text-muted-foreground">
                    {resultsLabel}
                  </div>
                </div>
                <table className="w-full text-sm">
                  <thead className="bg-muted/50 text-left text-xs font-semibold text-muted-foreground">
                    <tr>
                      <th className="px-4 py-3">ID</th>
                      <th className="px-4 py-3">Merchant / Outlet</th>
                      <th className="px-4 py-3">Contact</th>
                      <th className="px-4 py-3">FID / OID</th>
                      <th className="px-4 py-3">Issue</th>
                      <th className="px-4 py-3">ClickUp</th>
                      <th className="px-4 py-3">Status</th>
                      <th className="px-4 py-3">Created</th>
                      <th className="px-4 py-3">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {tickets.map((ticket, index) => {
                      const chatUrl = getChatUrl(ticket.customerPhone)
                      const chatMessage = getTicketChatMessage(ticket)
                      const chatHref = chatUrl
                        ? `${chatUrl}?text=${encodeURIComponent(chatMessage)}`
                        : null
                      const isResolved = ticket.status === "Resolved"
                      const statusColors = getTicketStatusColors(ticket.status)
                      const clickupStatusColors = getClickUpStatusColors(
                        ticket.clickupTaskStatus
                      )
                      const hasClickUpTask = Boolean(
                        ticket.clickupTaskId || ticket.clickupLink
                      )
                      const resolvedDate = ticket.resolvedAt
                        ? formatDateTime(ticket.resolvedAt)
                        : "--"
                      const closeDuration =
                        getCloseDuration(ticket.createdAt, ticket.resolvedAt) ?? "--"

                      return (
                        <tr
                          key={ticket.id}
                          className={index % 2 === 0 ? "bg-background" : "bg-muted/20"}
                        >
                          <td className="px-4 py-3 font-medium">#{ticket.id}</td>
                          <td className="px-4 py-3">
                            <div className="font-semibold">
                              {ticket.franchiseName ?? "--"}
                            </div>
                            <div className="text-xs text-muted-foreground">
                              {ticket.outletName ?? "--"}
                            </div>
                          </td>
                          <td className="px-4 py-3">
                            <div className="font-semibold">
                              {ticket.customerName ?? "--"}
                            </div>
                            {ticket.customerPhone && chatUrl ? (
                              <a
                                className="text-xs text-primary hover:underline"
                                href={chatHref ?? chatUrl}
                                target="_blank"
                              rel="noreferrer"
                            >
                              <span className="inline-flex items-center gap-1">
                                {ticket.customerPhone}
                                <SquareArrowOutUpRight className="size-3" aria-hidden="true" />
                              </span>
                            </a>
                            ) : ticket.customerPhone ? (
                              <div className="text-xs text-muted-foreground">
                                {ticket.customerPhone}
                              </div>
                            ) : (
                              <div className="text-xs text-muted-foreground">--</div>
                            )}
                          </td>
                          <td className="px-4 py-3 text-xs">
                            {ticket.fid ? (
                              <a
                                className="font-semibold text-rose-700 hover:underline dark:text-rose-300"
                                href={`https://cloud.getslurp.com/batcave/franchise/${encodeURIComponent(ticket.fid)}`}
                                target="_blank"
                                rel="noreferrer"
                              >
                                <span className="inline-flex items-center gap-1">
                                  {ticket.fid}
                                  <SquareArrowOutUpRight className="size-3" aria-hidden="true" />
                                </span>
                              </a>
                            ) : (
                              <span className="font-semibold text-muted-foreground">--</span>
                            )}
                            <br />
                            <span className="text-muted-foreground">
                              {ticket.oid ?? "--"}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-xs">
                            <div>{ticket.category ?? "--"}</div>
                            <div className="text-muted-foreground">
                              {ticket.subcategory1 ?? "--"}
                              {ticket.subcategory2
                                ? ` · ${ticket.subcategory2}`
                                : ""}
                            </div>
                          </td>
                          <td className="px-4 py-3 text-xs">
                            {hasClickUpTask ? (
                              <div className="space-y-1">
                                {ticket.clickupLink ? (
                                  <a
                                    className="font-medium text-primary hover:underline"
                                    href={ticket.clickupLink}
                                    target="_blank"
                                    rel="noreferrer"
                                  >
                                    <span className="inline-flex items-center gap-1">
                                      {ticket.clickupTaskId ?? "Open task"}
                                      <SquareArrowOutUpRight className="size-3" aria-hidden="true" />
                                    </span>
                                  </a>
                                ) : (
                                  <div className="font-medium">
                                    {ticket.clickupTaskId ?? "Open task"}
                                  </div>
                                )}
                                <span
                                  className="inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-semibold"
                                  style={{
                                    color: clickupStatusColors.text,
                                    backgroundColor: clickupStatusColors.background,
                                  }}
                                >
                                  {ticket.clickupTaskStatus
                                    ? toProperCase(ticket.clickupTaskStatus)
                                    : ""}
                                </span>
                              </div>
                            ) : (
                              <span />
                            )}
                          </td>
                          <td className="px-4 py-3">
                            {isResolved ? (
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <span
                                    className="inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-semibold whitespace-nowrap"
                                    style={{
                                      color: statusColors.text,
                                      backgroundColor: statusColors.background,
                                    }}
                                  >
                                    <span
                                      className="size-2 rounded-full"
                                      style={{ backgroundColor: statusColors.text }}
                                    />
                                    {formatStatusLabel(ticket.status)}
                                  </span>
                                </TooltipTrigger>
                                <TooltipContent sideOffset={6}>
                                  <div>Resolved: {resolvedDate}</div>
                                  <div>Duration: {closeDuration}</div>
                                </TooltipContent>
                            </Tooltip>
                          ) : (
                              <span
                                className="inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-semibold whitespace-nowrap"
                                style={{
                                  color: statusColors.text,
                                  backgroundColor: statusColors.background,
                                }}
                              >
                                <span
                                  className="size-2 rounded-full"
                                  style={{ backgroundColor: statusColors.text }}
                                />
                                {formatStatusLabel(ticket.status)}
                              </span>
                            )}
                            {ticket.msAgentName ? (
                              <div className="mt-2 text-xs text-muted-foreground">
                                {ticket.msAgentName}
                              </div>
                            ) : null}
                          </td>
                          <td className="px-4 py-3 text-xs text-muted-foreground">
                            {formatDateTime(ticket.createdAt)}
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-2">
                              {ticket.status === "Open" ? (
                                <Button
                                  size="sm"
                                  onClick={() => void handleAttendTicket(ticket.id)}
                                  disabled={attendingTicketId === ticket.id}
                                >
                                  {attendingTicketId === ticket.id ? "Attending..." : "Attend"}
                                </Button>
                              ) : null}
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => void openTicketModal(ticket.id)}
                              >
                                View
                              </Button>
                            </div>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
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
                              page === 1
                                ? "pointer-events-none opacity-50"
                                : undefined
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
            </div>
          ) : (
            <div className="text-muted-foreground text-sm">
              No tickets match the selected filters.
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog
        open={dialogOpen}
        onOpenChange={(next) => {
          setDialogOpen(next)
          if (!next) {
            setSelectedTicketId(null)
            setTicketDetail(null)
            setTicketDraft(null)
            setHistoryDialogOpen(false)
            setHistoryRows([])
          }
        }}
      >
        <DialogContent className="max-h-[90vh] w-[96vw] md:w-[60vw] max-w-[1200px] overflow-y-auto p-0">
          <div className="bg-background sticky top-0 z-20 border-b px-6 py-4">
            <DialogHeader>
              <DialogTitle>
                Ticket #{ticketDraft?.id ?? selectedTicketId ?? "--"}
              </DialogTitle>
              <DialogDescription>
                {ticketDraft
                  ? `Created ${formatDateTime(ticketDraft.createdAt)} · Updated ${formatDateTime(
                      ticketDraft.updatedAt
                    )} · Updated by ${ticketDraft.updatedBy ?? "--"}`
                  : "Loading ticket details..."}
              </DialogDescription>
            </DialogHeader>
          </div>

          <div className="px-6 py-4">
            {detailLoading || !ticketDraft ? (
              <div className="text-muted-foreground text-sm">Loading ticket details...</div>
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
                      {ticketDraft.status}
                    </span>
                  </TooltipTrigger>
                  {ticketDraft.status === "Resolved" ? (
                    <TooltipContent>
                      <div>
                        Resolved:{" "}
                        {selectedResolvedAt ? formatDateTime(selectedResolvedAt) : "--"}
                      </div>
                      <div>
                        Duration:{" "}
                        {getCloseDuration(
                          ticketDraft.createdAt,
                          selectedResolvedAt
                        ) ?? "--"}
                      </div>
                    </TooltipContent>
                  ) : null}
                </Tooltip>
                {ticketDraft.attachments.map((url, index) => (
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
                {ticketDraft.clickupLink ? (
                  <a
                    href={ticketDraft.clickupLink}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 rounded-full border px-3 py-1 text-xs hover:bg-muted/60"
                  >
                    ClickUp Task
                    <SquareArrowOutUpRight className="size-3" aria-hidden="true" />
                  </a>
                ) : null}
                <span className="inline-flex items-center rounded-full border px-3 py-1 text-xs">
                  Assigned MS PIC: {selectedAgentName}
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
                        {ticketDraft.franchiseName ?? "--"}
                      </div>
                    </div>
                    <div>
                      <div className="text-muted-foreground mb-1 text-xs">Outlet</div>
                      <div className="bg-muted/40 rounded-md border px-3 py-2 text-sm">
                        {ticketDraft.outletName ?? "--"}
                      </div>
                    </div>
                  </div>
                  <div className="grid gap-2 md:grid-cols-2">
                    <div>
                      <div className="text-muted-foreground mb-1 text-xs">Merchant Name</div>
                      <Input
                        value={ticketDraft.merchantName ?? ""}
                        onChange={(event) =>
                          setTicketDraft({
                            ...ticketDraft,
                            merchantName: event.target.value,
                          })
                        }
                      />
                    </div>
                    <div>
                      <div className="text-muted-foreground mb-1 text-xs">Phone No.</div>
                      <Input
                        value={ticketDraft.customerPhone ?? ""}
                        onChange={(event) =>
                          setTicketDraft({
                            ...ticketDraft,
                            customerPhone: event.target.value,
                          })
                        }
                      />
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
                  <div className="flex items-center gap-2">
                    <span>Status:</span>
                    <span
                      className="inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-semibold"
                      style={{
                        color: getCsatStatusColors(ticketDraft.csat.surveyStatus).text,
                        backgroundColor: getCsatStatusColors(ticketDraft.csat.surveyStatus)
                          .background,
                      }}
                    >
                      {ticketDraft.csat.surveyStatus}
                    </span>
                  </div>
                  <div>Token: {ticketDraft.csat.tokenPreview ?? "--"}</div>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => csatUrl && window.open(csatUrl, "_blank")}
                      disabled={!csatActionsEnabled}
                    >
                      Open
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => void handleCopyCsat()}
                      disabled={!csatActionsEnabled}
                    >
                      Copy
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => void handleShareCsatLink()}
                      disabled={!csatActionsEnabled || !ticketDraft.customerPhone}
                    >
                      Share Link
                    </Button>
                  </div>
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
                        <div className="flex items-center gap-2">
                          <Input
                            value={ticketDraft.fid ?? ""}
                            onChange={(event) =>
                              setTicketDraft({ ...ticketDraft, fid: event.target.value })
                            }
                            onBlur={() => void resolveDraftFranchiseOutlet()}
                          />
                          {ticketDraft.fid ? (
                            <a
                              href={`https://cloud.getslurp.com/batcave/franchise/${encodeURIComponent(ticketDraft.fid)}`}
                              target="_blank"
                              rel="noreferrer"
                              className="text-primary inline-flex items-center gap-1 text-xs hover:underline"
                            >
                              Batcave
                              <SquareArrowOutUpRight className="size-3" aria-hidden="true" />
                            </a>
                          ) : null}
                        </div>
                      </div>
                      <div>
                        <div className="text-muted-foreground mb-1 text-xs">OID</div>
                        <Input
                          value={ticketDraft.oid ?? ""}
                          onChange={(event) =>
                            setTicketDraft({ ...ticketDraft, oid: event.target.value })
                          }
                          onBlur={() => void resolveDraftFranchiseOutlet()}
                        />
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <div className="text-muted-foreground mb-1 text-xs">
                          Assigned MS PIC
                        </div>
                        <Select
                          value={ticketDraft.msPicUserId ?? "unassigned"}
                          onValueChange={(value) => {
                            const nextAssignee =
                              value === "unassigned" ? null : value
                            const shouldAutoProgress =
                              Boolean(nextAssignee) && ticketDraft.status === "Open"
                            setTicketDraft({
                              ...ticketDraft,
                              msPicUserId: nextAssignee,
                              status: shouldAutoProgress ? "In Progress" : ticketDraft.status,
                            })
                          }}
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="unassigned">Unassigned</SelectItem>
                            {agents.map((agent) => (
                              <SelectItem key={agent.id} value={agent.id}>
                                {agent.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div>
                        <div className="text-muted-foreground mb-1 text-xs">Status</div>
                        <Select
                          value={ticketDraft.status}
                          onValueChange={(value) =>
                            setTicketDraft({ ...ticketDraft, status: value })
                          }
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {statusOptions.map((status) => (
                              <SelectItem key={status} value={status}>
                                {status}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <div className="text-muted-foreground mb-1 text-xs">Opened At</div>
                      <Input
                        type="datetime-local"
                        value={
                          ticketDraft.openedAt
                            ? ticketDraft.openedAt.replace(" ", "T").slice(0, 16)
                            : ""
                        }
                        onChange={(event) =>
                          setTicketDraft({
                            ...ticketDraft,
                            openedAt: event.target.value
                              ? event.target.value.replace("T", " ") + ":00.000"
                              : null,
                          })
                        }
                      />
                    </div>
                    <div>
                      <div className="text-muted-foreground mb-1 text-xs">Merchant Sentiment</div>
                      <Select
                        value={ticketDraft.merchantSentiment ?? "__none"}
                        onValueChange={(value) =>
                          setTicketDraft({
                            ...ticketDraft,
                            merchantSentiment: value === "__none" ? null : value,
                          })
                        }
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Select sentiment" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__none">Not set</SelectItem>
                          {sentimentOptions.map((sentiment) => (
                            <SelectItem key={sentiment} value={sentiment}>
                              {sentiment}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
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
                  <div>Current Task: {ticketDraft.clickupTaskId ?? "--"}</div>
                  <div className="flex items-center gap-2">
                    <span>ClickUp Status:</span>
                    {ticketDraft.clickupTaskId || ticketDraft.clickupLink ? (
                      <span
                        className="inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-semibold"
                        style={{
                          color: getClickUpStatusColors(ticketDraft.clickupTaskStatus).text,
                          backgroundColor: getClickUpStatusColors(ticketDraft.clickupTaskStatus)
                            .background,
                        }}
                      >
                        {ticketDraft.clickupTaskStatus
                          ? toProperCase(ticketDraft.clickupTaskStatus)
                          : ""}
                      </span>
                    ) : null}
                  </div>
                  <div className="text-muted-foreground text-xs">
                    Last synced:{" "}
                    {ticketDraft.clickupTaskStatusSyncedAt
                      ? formatDateTime(ticketDraft.clickupTaskStatusSyncedAt)
                      : "--"}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => void handleRefreshClickupStatus()}
                      disabled={
                        !clickupEnabled ||
                        !ticketDraft.clickupTaskId ||
                        clickupActionPending ||
                        detailSaving
                      }
                    >
                      Refresh status
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={handleCreateClickupTaskRequest}
                      disabled={
                        !clickupEnabled ||
                        clickupActionPending ||
                        detailSaving ||
                        Boolean(ticketDraft.clickupTaskId)
                      }
                    >
                      Create task
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={handleClickUpLink}
                      disabled={
                        !clickupEnabled ||
                        clickupActionPending ||
                        detailSaving ||
                        Boolean(ticketDraft.clickupTaskId || ticketDraft.clickupLink)
                      }
                    >
                      Link task
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={handleClickUpRemove}
                      disabled={
                        !clickupEnabled ||
                        !ticketDraft.clickupLink ||
                        clickupActionPending ||
                        detailSaving
                      }
                    >
                      Remove task
                    </Button>
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
                    <Select
                      value={ticketDraft.category ?? "__none"}
                      onValueChange={(value) => {
                        if (value === "__none") {
                          setTicketDraft({
                            ...ticketDraft,
                            category: null,
                            subcategory1: null,
                            subcategory2: null,
                          })
                          return
                        }
                        setTicketDraft({
                          ...ticketDraft,
                          category: value,
                          subcategory1: null,
                          subcategory2: null,
                        })
                      }}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select category" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none">Not set</SelectItem>
                        {ticketDraft.category &&
                        !categoryTree.some((category) => category.name === ticketDraft.category) ? (
                          <SelectItem value={ticketDraft.category}>
                            {ticketDraft.category}
                          </SelectItem>
                        ) : null}
                        {categoryTree.map((category) => (
                          <SelectItem key={category.id} value={category.name}>
                            {category.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <div className="text-muted-foreground mb-1 text-xs">Subcategory 1</div>
                    <Select
                      value={ticketDraft.subcategory1 ?? "__none"}
                      onValueChange={(value) => {
                        if (value === "__none") {
                          setTicketDraft({
                            ...ticketDraft,
                            subcategory1: null,
                            subcategory2: null,
                          })
                          return
                        }
                        setTicketDraft({
                          ...ticketDraft,
                          subcategory1: value,
                          subcategory2: null,
                        })
                      }}
                      disabled={!selectedCategoryNode}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select subcategory 1" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none">Not set</SelectItem>
                        {ticketDraft.subcategory1 &&
                        !subcategory1Options.some(
                          (subcategory) => subcategory.name === ticketDraft.subcategory1
                        ) ? (
                          <SelectItem value={ticketDraft.subcategory1}>
                            {ticketDraft.subcategory1}
                          </SelectItem>
                        ) : null}
                        {subcategory1Options.map((subcategory) => (
                          <SelectItem key={subcategory.id} value={subcategory.name}>
                            {subcategory.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  {subcategory2Options.length > 0 ? (
                    <div>
                      <div className="text-muted-foreground mb-1 text-xs">Subcategory 2</div>
                      <Select
                        value={ticketDraft.subcategory2 ?? "__none"}
                        onValueChange={(value) =>
                          setTicketDraft({
                            ...ticketDraft,
                            subcategory2: value === "__none" ? null : value,
                          })
                        }
                        disabled={!selectedSubcategory1Node}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Select subcategory 2" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__none">Not set</SelectItem>
                          {ticketDraft.subcategory2 &&
                          !subcategory2Options.some(
                            (subcategory) => subcategory.name === ticketDraft.subcategory2
                          ) ? (
                            <SelectItem value={ticketDraft.subcategory2}>
                              {ticketDraft.subcategory2}
                            </SelectItem>
                          ) : null}
                          {subcategory2Options.map((subcategory) => (
                            <SelectItem key={subcategory.id} value={subcategory.name}>
                              {subcategory.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  ) : null}
                  <div className="md:col-span-2">
                    <div className="text-muted-foreground mb-1 text-xs">
                      Issue Description
                    </div>
                    <textarea
                      className="border-input bg-background ring-offset-background placeholder:text-muted-foreground focus-visible:ring-ring min-h-[88px] w-full rounded-md border px-3 py-2 text-sm focus-visible:ring-2 focus-visible:outline-none"
                      value={ticketDraft.issueDescription ?? ""}
                      onChange={(event) =>
                        setTicketDraft({
                          ...ticketDraft,
                          issueDescription: event.target.value,
                        })
                      }
                    />
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm">Internal Notes</CardTitle>
                  <CardDescription>Internal context and follow-up notes.</CardDescription>
                </CardHeader>
                <CardContent>
                  <textarea
                    className="border-input bg-background ring-offset-background placeholder:text-muted-foreground focus-visible:ring-ring min-h-[100px] w-full rounded-md border px-3 py-2 text-sm focus-visible:ring-2 focus-visible:outline-none"
                    value={ticketDraft.ticketDescription ?? ""}
                    onChange={(event) =>
                      setTicketDraft({
                        ...ticketDraft,
                        ticketDescription: event.target.value || null,
                      })
                    }
                  />
                </CardContent>
              </Card>

              </div>
            )}
          </div>

          <div className="bg-background sticky bottom-0 z-20 border-t px-6 py-4">
            {modalInlineError ? (
              <div className="text-destructive mb-3 text-sm">{modalInlineError}</div>
            ) : null}
            <DialogFooter className="flex-wrap justify-between gap-2 sm:flex-row">
              <div className="flex flex-wrap items-center gap-2">
                {canArchive ? (
                  <Button
                    type="button"
                    variant="outline"
                    disabled={!ticketDraft || detailSaving}
                    onClick={() => void handleArchiveToggle()}
                  >
                    {ticketDraft?.hidden ? "Unarchive" : "Archive"}
                  </Button>
                ) : null}
                <Button
                  type="button"
                  variant="outline"
                  disabled={!selectedTicketId || detailSaving}
                  onClick={handleOpenTicketHistory}
                >
                  Ticket History
                </Button>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setDialogOpen(false)}
                  disabled={detailSaving}
                >
                  Close
                </Button>
                <Button
                  type="button"
                  onClick={() => void handleSaveTicket()}
                  disabled={!isDraftDirty || detailSaving || detailLoading}
                >
                  {detailSaving ? "Saving..." : "Save"}
                </Button>
              </div>
            </DialogFooter>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={historyDialogOpen} onOpenChange={setHistoryDialogOpen}>
        <DialogContent className="max-w-5xl">
          <DialogHeader>
            <DialogTitle>Ticket History</DialogTitle>
            <DialogDescription>
              Field-level change audit trail for ticket #{ticketDraft?.id ?? selectedTicketId ?? "--"}.
            </DialogDescription>
          </DialogHeader>
          {historyLoading ? (
            <div className="text-muted-foreground text-sm">Loading history...</div>
          ) : historyRows.length ? (
            <div className="max-h-[65vh] overflow-auto rounded-md border">
              <table className="w-full text-xs">
                <thead className="bg-muted/50 text-left">
                  <tr>
                    <th className="px-3 py-2">Field</th>
                    <th className="px-3 py-2">Timestamp</th>
                    <th className="px-3 py-2">Old Value</th>
                    <th className="px-3 py-2">New Value</th>
                    <th className="px-3 py-2">Changed By</th>
                  </tr>
                </thead>
                <tbody>
                  {historyRows.map((item) => (
                    <tr key={item.id} className="border-t">
                      <td className="px-3 py-2">{formatHistoryField(item.field)}</td>
                      <td className="px-3 py-2">{formatDateTime(item.changedAt)}</td>
                      <td className="px-3 py-2">
                        {formatHistoryValue(item.field, item.oldValue)}
                      </td>
                      <td className="px-3 py-2">
                        {formatHistoryValue(item.field, item.newValue)}
                      </td>
                      <td className="px-3 py-2">{item.changedBy ?? "--"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="text-muted-foreground text-sm">No history records yet.</div>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setHistoryDialogOpen(false)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={linkDialogOpen} onOpenChange={setLinkDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Link Existing Task</DialogTitle>
            <DialogDescription>
              Enter the ClickUp task link. Press Enter to apply.
            </DialogDescription>
          </DialogHeader>
          <form
            className="space-y-3"
            onSubmit={(event) => {
              event.preventDefault()
              void handleApplyClickupLink()
            }}
          >
            <div>
              <div className="text-muted-foreground mb-1 text-xs">Task Link</div>
              <Input
                value={linkTaskUrlInput}
                onChange={(event) => setLinkTaskUrlInput(event.target.value)}
                placeholder="https://app.clickup.com/t/..."
              />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setLinkDialogOpen(false)}>
                Close
              </Button>
              <Button type="submit" disabled={clickupActionPending}>
                Apply
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(errorDialogMessage)}
        onOpenChange={(next) => {
          if (!next) {
            setErrorDialogMessage(null)
          }
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Action Failed</DialogTitle>
            <DialogDescription>{errorDialogMessage ?? "An error occurred."}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" onClick={() => setErrorDialogMessage(null)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
