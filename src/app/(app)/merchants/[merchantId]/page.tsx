"use client"

import * as React from "react"
import Link from "next/link"
import { useParams, useRouter } from "next/navigation"
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Loader2,
  SquareArrowOutUpRight,
} from "lucide-react"

import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import { ExternalLink } from "@/components/external-link"
import { useToast } from "@/components/toast-provider"
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
import { formatDateTime, parseDate } from "@/lib/dates"
import { getSessionUser } from "@/lib/session"

type MerchantDetail = {
  id: string
  external_id: string
  name: string
  fid: string | null
  outlet_count: number
  status: string | null
  created_at: string
  updated_at: string
  details: {
    company: string | null
    company_address: string | null
    country: string | null
    timezone_offset: string | null
    slug: string | null
    closed_account: boolean | null
    test_account: boolean | null
    branch_id: string | null
    branch_code: string | null
    branch_name: string | null
    branch_group: string | null
  }
}

type MerchantDetailOutlet = {
  id: string
  external_id: string
  name: string
  status: string | null
  merchant_id: string | null
  updated_at: string
  created_at: string | null
  address: string | null
  unit_no: string | null
  latitude: string | null
  longitude: string | null
  maps_url: string | null
  valid_until: string | null
}

type MerchantDetailTicket = {
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

type MerchantTicketsResponse = {
  tickets: MerchantDetailTicket[]
  total: number
  page: number
  perPage: number
}

type MerchantNavigation = {
  previousMerchantId: string | null
  nextMerchantId: string | null
}

type TicketSummary = {
  total: number
  open: number
  inProgress: number
  pendingCustomer: number
  resolved: number
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

function getTicketStatusColors(status: string) {
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

function getOutletStatusLabel(validUntil: string | null) {
  if (!validUntil) {
    return "Active"
  }
  const parsed = parseDate(validUntil)
  if (!parsed) {
    return "Active"
  }
  const diffMs = parsed.getTime() - Date.now()
  if (diffMs < 0) {
    return "Expired"
  }
  const daysUntil = diffMs / (1000 * 60 * 60 * 24)
  if (daysUntil <= 30) {
    return "Expiring Soon"
  }
  return "Active"
}

function getOutletStatusClasses(status: string) {
  switch (status) {
    case "Expired":
      return "bg-rose-500/10 text-rose-700 dark:text-rose-300"
    case "Expiring Soon":
      return "bg-amber-500/15 text-amber-700 dark:text-amber-300"
    default:
      return "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
  }
}

function getPaginationItems(current: number, total: number) {
  if (total <= 1) {
    return [1]
  }
  if (total <= 5) {
    return Array.from({ length: total }, (_, index) => index + 1)
  }

  const items: Array<number | "ellipsis"> = [1]
  const start = Math.max(2, current - 1)
  const end = Math.min(total - 1, current + 1)

  if (start > 2) {
    items.push("ellipsis")
  }
  for (let page = start; page <= end; page += 1) {
    items.push(page)
  }
  if (end < total - 1) {
    items.push("ellipsis")
  }
  items.push(total)
  return items
}

const ticketPerPageOptions = [10, 25, 50, 100] as const

export default function MerchantDetailPage() {
  const params = useParams<{ merchantId: string }>()
  const merchantId = params.merchantId
  const router = useRouter()
  const { showToast } = useToast()

  const [merchant, setMerchant] = React.useState<MerchantDetail | null>(null)
  const [outlets, setOutlets] = React.useState<MerchantDetailOutlet[]>([])
  const [navigation, setNavigation] = React.useState<MerchantNavigation>({
    previousMerchantId: null,
    nextMerchantId: null,
  })
  const [ticketSummary, setTicketSummary] = React.useState<TicketSummary>({
    total: 0,
    open: 0,
    inProgress: 0,
    pendingCustomer: 0,
    resolved: 0,
  })
  const [tickets, setTickets] = React.useState<MerchantDetailTicket[]>([])
  const [selectedOutletId, setSelectedOutletId] = React.useState("all")
  const [expandedOutletId, setExpandedOutletId] = React.useState<string | null>(null)
  const [ticketsPage, setTicketsPage] = React.useState(1)
  const [ticketsPerPage, setTicketsPerPage] = React.useState(10)
  const [ticketTotalCount, setTicketTotalCount] = React.useState(0)
  const [loading, setLoading] = React.useState(true)
  const [ticketsLoading, setTicketsLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [selectedTicketId, setSelectedTicketId] = React.useState<string | null>(null)
  const [ticketDetail, setTicketDetail] = React.useState<TicketDetail | null>(null)
  const [detailLoading, setDetailLoading] = React.useState(false)
  const [detailError, setDetailError] = React.useState<string | null>(null)

  React.useEffect(() => {
    setSelectedTicketId(null)
    setTicketDetail(null)
    setDetailError(null)
    setSelectedOutletId("all")
    setExpandedOutletId(null)
    setTicketsPage(1)
  }, [merchantId])

  React.useEffect(() => {
    const user = getSessionUser()
    if (!user?.id) {
      setLoading(false)
      setTicketsLoading(false)
      setError("Please log in to view merchant details.")
      return
    }

    let cancelled = false

    const loadMerchant = async () => {
      setLoading(true)
      setError(null)
      try {
        const response = await fetch(`/api/merchants/${merchantId}`, {
          headers: { "x-user-id": user.id },
        })
        if (!response.ok) {
          const payload = (await response.json().catch(() => ({}))) as { error?: string }
          throw new Error(payload.error ?? "Unable to load merchant.")
        }
        const payload = (await response.json()) as {
          merchant: MerchantDetail
          outlets: MerchantDetailOutlet[]
          navigation: MerchantNavigation
          ticketSummary: TicketSummary
        }
        if (cancelled) {
          return
        }
        setMerchant(payload.merchant)
        setOutlets(payload.outlets ?? [])
        setNavigation(
          payload.navigation ?? { previousMerchantId: null, nextMerchantId: null }
        )
        setTicketSummary(
          payload.ticketSummary ?? {
            total: 0,
            open: 0,
            inProgress: 0,
            pendingCustomer: 0,
            resolved: 0,
          }
        )
      } catch (loadError) {
        if (cancelled) {
          return
        }
        console.error(loadError)
        setError(
          loadError instanceof Error ? loadError.message : "Unable to load merchant."
        )
      } finally {
        if (!cancelled) {
          setLoading(false)
        }
      }
    }

    void loadMerchant()

    return () => {
      cancelled = true
    }
  }, [merchantId])

  React.useEffect(() => {
    const user = getSessionUser()
    if (!user?.id) {
      setTicketsLoading(false)
      return
    }

    let cancelled = false

    const loadTickets = async () => {
      setTicketsLoading(true)
      try {
        const params = new URLSearchParams()
        params.set("page", String(ticketsPage))
        params.set("per_page", String(ticketsPerPage))
        if (selectedOutletId !== "all") {
          params.set("outlet_id", selectedOutletId)
        }

        const response = await fetch(`/api/merchants/${merchantId}/tickets?${params.toString()}`, {
          headers: { "x-user-id": user.id },
        })
        if (!response.ok) {
          const payload = (await response.json().catch(() => ({}))) as { error?: string }
          throw new Error(payload.error ?? "Unable to load tickets.")
        }
        const payload = (await response.json()) as MerchantTicketsResponse
        if (!cancelled) {
          setTickets(payload.tickets ?? [])
          setTicketTotalCount(payload.total ?? 0)
        }
      } catch (loadError) {
        if (cancelled) {
          return
        }
        console.error(loadError)
        showToast(
          loadError instanceof Error ? loadError.message : "Unable to load tickets.",
          "error"
        )
        setTickets([])
        setTicketTotalCount(0)
      } finally {
        if (!cancelled) {
          setTicketsLoading(false)
        }
      }
    }

    void loadTickets()

    return () => {
      cancelled = true
    }
  }, [merchantId, selectedOutletId, showToast, ticketsPage, ticketsPerPage])

  React.useEffect(() => {
    const user = getSessionUser()
    if (!user?.id || !selectedTicketId) {
      return
    }

    let cancelled = false

    const loadTicketDetail = async () => {
      setDetailLoading(true)
      setDetailError(null)
      setTicketDetail(null)
      try {
        const response = await fetch(`/api/tickets/${selectedTicketId}`, {
          headers: { "x-user-id": user.id },
        })
        if (!response.ok) {
          const payload = (await response.json().catch(() => ({}))) as { error?: string }
          throw new Error(payload.error ?? "Unable to load ticket details.")
        }
        const payload = (await response.json()) as { ticket: TicketDetail }
        if (!cancelled) {
          setTicketDetail(payload.ticket)
        }
      } catch (loadError) {
        if (cancelled) {
          return
        }
        console.error(loadError)
        setDetailError(
          loadError instanceof Error
            ? loadError.message
            : "Unable to load ticket details."
        )
      } finally {
        if (!cancelled) {
          setDetailLoading(false)
        }
      }
    }

    void loadTicketDetail()

    return () => {
      cancelled = true
    }
  }, [selectedTicketId])

  const selectedStatusColors = getTicketStatusColors(ticketDetail?.status ?? "")
  const selectedResolvedAt =
    ticketDetail?.closedAt ?? (ticketDetail?.status === "Resolved" ? ticketDetail.updatedAt : null)
  const ticketTotalPages = Math.max(1, Math.ceil(ticketTotalCount / ticketsPerPage))
  const ticketPaginationItems = React.useMemo(
    () => getPaginationItems(ticketsPage, ticketTotalPages),
    [ticketTotalPages, ticketsPage]
  )

  React.useEffect(() => {
    if (ticketsPage > ticketTotalPages) {
      setTicketsPage(ticketTotalPages)
    }
  }, [ticketTotalPages, ticketsPage])

  return (
    <>
      <div className="animate-in fade-in slide-in-from-bottom-2 flex flex-col gap-6">
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Button asChild variant="outline" size="sm">
              <Link href="/merchants">
                <ChevronLeft className="size-4" />
                Back to merchants
              </Link>
            </Button>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={!navigation.previousMerchantId}
                onClick={() => {
                  if (navigation.previousMerchantId) {
                    router.push(`/merchants/${navigation.previousMerchantId}`)
                  }
                }}
              >
                <ChevronLeft className="size-4" />
                Previous
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={!navigation.nextMerchantId}
                onClick={() => {
                  if (navigation.nextMerchantId) {
                    router.push(`/merchants/${navigation.nextMerchantId}`)
                  }
                }}
              >
                Next
                <ChevronRight className="size-4" />
              </Button>
            </div>
          </div>

          {loading ? (
            <div className="text-muted-foreground flex items-center gap-2 text-sm">
              <Loader2 className="size-4 animate-spin" />
              Loading merchant details...
            </div>
          ) : error ? (
            <div className="text-destructive text-sm">{error}</div>
          ) : merchant ? (
            <>
              <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                <div className="space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <h1 className="text-2xl font-semibold tracking-tight">
                      {merchant.name}
                    </h1>
                    {merchant.details.closed_account ? (
                      <span className="rounded-full bg-rose-500/10 px-2.5 py-1 text-xs font-medium text-rose-700 dark:text-rose-300">
                        Closed
                      </span>
                    ) : merchant.details.test_account ? (
                      <span className="rounded-full bg-amber-500/15 px-2.5 py-1 text-xs font-medium text-amber-700 dark:text-amber-300">
                        Test
                      </span>
                    ) : (
                      <span className="rounded-full bg-emerald-500/10 px-2.5 py-1 text-xs font-medium text-emerald-700 dark:text-emerald-300">
                        Live
                      </span>
                    )}
                  </div>
                  <p className="text-muted-foreground text-sm">
                    Merchant details, outlets, and linked tickets for this franchise.
                  </p>
                  <div className="text-muted-foreground flex flex-wrap items-center gap-3 text-xs">
                    <span>
                      FID:{" "}
                      {merchant.fid ? (
                        <ExternalLink
                          href={`https://cloud.getslurp.com/batcave/franchise/${merchant.fid}`}
                        >
                          {merchant.fid}
                        </ExternalLink>
                      ) : (
                        "Pending"
                      )}
                    </span>
                    <span>{merchant.outlet_count} outlets</span>
                    <span>Updated {formatDateTime(merchant.updated_at)}</span>
                  </div>
                </div>
              </div>

              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
                {[
                  { label: "Total tickets", value: ticketSummary.total },
                  { label: "Open", value: ticketSummary.open },
                  { label: "In progress", value: ticketSummary.inProgress },
                  { label: "Pending customer", value: ticketSummary.pendingCustomer },
                  { label: "Resolved", value: ticketSummary.resolved },
                ].map((item) => (
                  <Card key={item.label}>
                    <CardHeader className="pb-2">
                      <CardDescription>{item.label}</CardDescription>
                    </CardHeader>
                    <CardContent>
                      <div className="text-2xl font-semibold">{item.value}</div>
                    </CardContent>
                  </Card>
                ))}
              </div>

              <div className="grid gap-6 xl:grid-cols-[1.05fr_1.45fr]">
                <div className="space-y-6">
                  <Card>
                    <CardHeader>
                      <CardTitle>Merchant details</CardTitle>
                      <CardDescription>Core franchise metadata from Slurp! Cloud.</CardDescription>
                    </CardHeader>
                    <CardContent className="grid gap-3 text-sm md:grid-cols-2">
                      <div>
                        <div className="text-muted-foreground mb-1 text-xs">Company</div>
                        <div className="bg-muted/40 rounded-md border px-3 py-2">
                          {merchant.details.company ?? merchant.name}
                        </div>
                      </div>
                      <div>
                        <div className="text-muted-foreground mb-1 text-xs">Branch</div>
                        <div className="bg-muted/40 rounded-md border px-3 py-2">
                          {merchant.details.branch_name ?? merchant.details.branch_code ?? "--"}
                        </div>
                      </div>
                      <div className="md:col-span-2">
                        <div className="text-muted-foreground mb-1 text-xs">
                          Company address
                        </div>
                        <div className="bg-muted/40 rounded-md border px-3 py-2 whitespace-pre-wrap">
                          {merchant.details.company_address ?? "--"}
                        </div>
                      </div>
                      <div>
                        <div className="text-muted-foreground mb-1 text-xs">Country</div>
                        <div className="bg-muted/40 rounded-md border px-3 py-2">
                          {merchant.details.country ?? "--"}
                        </div>
                      </div>
                      <div>
                        <div className="text-muted-foreground mb-1 text-xs">Timezone</div>
                        <div className="bg-muted/40 rounded-md border px-3 py-2">
                          {merchant.details.timezone_offset ?? "--"}
                        </div>
                      </div>
                      <div>
                        <div className="text-muted-foreground mb-1 text-xs">Branch group</div>
                        <div className="bg-muted/40 rounded-md border px-3 py-2">
                          {merchant.details.branch_group ?? "--"}
                        </div>
                      </div>
                      <div>
                        <div className="text-muted-foreground mb-1 text-xs">Slug</div>
                        <div className="bg-muted/40 rounded-md border px-3 py-2">
                          {merchant.details.slug ?? "--"}
                        </div>
                      </div>
                      <div>
                        <div className="text-muted-foreground mb-1 text-xs">Created at</div>
                        <div className="bg-muted/40 rounded-md border px-3 py-2">
                          {formatDateTime(merchant.created_at)}
                        </div>
                      </div>
                      <div>
                        <div className="text-muted-foreground mb-1 text-xs">Updated at</div>
                        <div className="bg-muted/40 rounded-md border px-3 py-2">
                          {formatDateTime(merchant.updated_at)}
                        </div>
                      </div>
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader>
                      <CardTitle>Outlets</CardTitle>
                      <CardDescription>
                        {outlets.length} outlet{outlets.length === 1 ? "" : "s"} linked to this
                        merchant.
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      {outlets.length === 0 ? (
                        <div className="text-muted-foreground text-sm">No outlets found.</div>
                      ) : (
                        outlets.map((outlet) => {
                          const outletStatus = getOutletStatusLabel(outlet.valid_until)
                          return (
                            <Collapsible
                              key={outlet.id}
                              open={expandedOutletId === outlet.id}
                              onOpenChange={() => {
                                setExpandedOutletId((current) =>
                                  current === outlet.id ? null : outlet.id
                                )
                              }}
                            >
                              <div className="rounded-lg border text-sm">
                                <CollapsibleTrigger asChild>
                                  <button
                                    type="button"
                                    className="hover:bg-muted/40 flex w-full flex-col gap-2 px-4 py-3 text-left transition"
                                  >
                                    <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                                      <div>
                                        <div className="font-medium">{outlet.name}</div>
                                        <div className="text-muted-foreground text-xs">
                                          OID {outlet.external_id}
                                        </div>
                                      </div>
                                      <div className="flex items-center gap-2 self-start md:self-auto">
                                        <span
                                          className={[
                                            "rounded-full px-2.5 py-1 text-xs font-medium",
                                            getOutletStatusClasses(outletStatus),
                                          ].join(" ")}
                                        >
                                          {outletStatus}
                                        </span>
                                        {expandedOutletId === outlet.id ? (
                                          <ChevronDown className="text-muted-foreground size-4" />
                                        ) : (
                                          <ChevronRight className="text-muted-foreground size-4" />
                                        )}
                                      </div>
                                    </div>
                                  </button>
                                </CollapsibleTrigger>
                                <CollapsibleContent>
                                  <div className="border-t px-4 py-3">
                                    <div className="grid gap-2 text-xs text-muted-foreground md:grid-cols-2">
                                      <div>
                                        <span className="block text-[11px] uppercase tracking-wide">
                                          Address
                                        </span>
                                        <span className="text-foreground">
                                          {outlet.address ?? "Address pending"}
                                        </span>
                                      </div>
                                      <div>
                                        <span className="block text-[11px] uppercase tracking-wide">
                                          Valid until
                                        </span>
                                        <span className="text-foreground">
                                          {outlet.valid_until
                                            ? formatDateTime(outlet.valid_until)
                                            : "--"}
                                        </span>
                                      </div>
                                      <div>
                                        <span className="block text-[11px] uppercase tracking-wide">
                                          Created at
                                        </span>
                                        <span className="text-foreground">
                                          {outlet.created_at
                                            ? formatDateTime(outlet.created_at)
                                            : "--"}
                                        </span>
                                      </div>
                                      <div>
                                        <span className="block text-[11px] uppercase tracking-wide">
                                          Updated at
                                        </span>
                                        <span className="text-foreground">
                                          {formatDateTime(outlet.updated_at)}
                                        </span>
                                      </div>
                                      {outlet.maps_url ? (
                                        <div className="md:col-span-2">
                                          <span className="block text-[11px] uppercase tracking-wide">
                                            Maps
                                          </span>
                                          <ExternalLink href={outlet.maps_url}>
                                            View location
                                          </ExternalLink>
                                        </div>
                                      ) : null}
                                    </div>
                                  </div>
                                </CollapsibleContent>
                              </div>
                            </Collapsible>
                          )
                        })
                      )}
                    </CardContent>
                  </Card>
                </div>

                <Card>
                  <CardHeader>
                    <CardTitle>Associated tickets</CardTitle>
                    <CardDescription>
                      Tickets linked by merchant FID across all outlets.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                      <div className="flex flex-col gap-3 md:flex-row md:items-center">
                        <div className="md:w-[220px]">
                          <Select
                            value={selectedOutletId}
                            onValueChange={(value) => {
                              setSelectedOutletId(value)
                              setTicketsPage(1)
                            }}
                          >
                            <SelectTrigger>
                              <SelectValue placeholder="Filter by outlet" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="all">All outlets</SelectItem>
                              {outlets.map((outlet) => (
                                <SelectItem
                                  key={outlet.id}
                                  value={outlet.external_id}
                                >
                                  {outlet.name} ({outlet.external_id})
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                          <span>Records per page</span>
                          <Select
                            value={String(ticketsPerPage)}
                            onValueChange={(value) => {
                              setTicketsPerPage(Number(value))
                              setTicketsPage(1)
                            }}
                          >
                            <SelectTrigger className="h-8 w-[92px] text-xs">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {ticketPerPageOptions.map((option) => (
                                <SelectItem key={option} value={String(option)}>
                                  {option}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      </div>
                      <div className="text-muted-foreground text-xs">
                        {ticketTotalCount} ticket{ticketTotalCount === 1 ? "" : "s"}
                      </div>
                    </div>

                    {ticketsLoading ? (
                      <div className="text-muted-foreground flex items-center gap-2 text-sm">
                        <Loader2 className="size-4 animate-spin" />
                        Loading tickets...
                      </div>
                    ) : tickets.length === 0 ? (
                      <div className="text-muted-foreground text-sm">
                        No tickets found for this merchant.
                      </div>
                    ) : (
                      tickets.map((ticket, index) => {
                        const statusColors = getTicketStatusColors(ticket.status)
                        const clickupColors = getClickUpStatusColors(ticket.clickupTaskStatus)

                        return (
                          <div key={ticket.id} className="space-y-4">
                            <button
                              type="button"
                              className="hover:bg-muted/40 w-full rounded-lg border px-4 py-4 text-left transition"
                              onClick={() => setSelectedTicketId(ticket.id)}
                            >
                              <div className="flex flex-col gap-3">
                                <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                                  <div className="space-y-2">
                                    <div className="flex flex-wrap items-center gap-2">
                                      <span className="font-semibold">Ticket #{ticket.id}</span>
                                      <span
                                        className="inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-semibold"
                                        style={{
                                          color: statusColors.text,
                                          backgroundColor: statusColors.background,
                                        }}
                                      >
                                        {ticket.status}
                                      </span>
                                      {ticket.hidden ? (
                                        <span className="rounded-full border px-2.5 py-1 text-[11px]">
                                          Archived
                                        </span>
                                      ) : null}
                                    </div>
                                    <div className="text-muted-foreground text-sm">
                                      {ticket.outletName ?? ticket.customerName ?? "--"}
                                    </div>
                                  </div>
                                  <div className="text-muted-foreground text-xs md:text-right">
                                    <div>Created {formatDateTime(ticket.createdAt)}</div>
                                    <div>
                                      Resolved{" "}
                                      {ticket.resolvedAt
                                        ? formatDateTime(ticket.resolvedAt)
                                        : "--"}
                                    </div>
                                  </div>
                                </div>

                                <div className="grid gap-3 text-xs text-muted-foreground md:grid-cols-2 xl:grid-cols-4">
                                  <div>
                                    <span className="block text-[11px] uppercase tracking-wide">
                                      Category
                                    </span>
                                    <span className="text-foreground">
                                      {ticket.category ?? "--"}
                                    </span>
                                  </div>
                                  <div>
                                    <span className="block text-[11px] uppercase tracking-wide">
                                      Assigned MS PIC
                                    </span>
                                    <span className="text-foreground">
                                      {ticket.msAgentName ?? "--"}
                                    </span>
                                  </div>
                                  <div>
                                    <span className="block text-[11px] uppercase tracking-wide">
                                      OID
                                    </span>
                                    <span className="text-foreground">{ticket.oid ?? "--"}</span>
                                  </div>
                                  <div>
                                    <span className="block text-[11px] uppercase tracking-wide">
                                      ClickUp
                                    </span>
                                    {ticket.clickupTaskId || ticket.clickupLink ? (
                                      <span
                                        className="inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold"
                                        style={{
                                          color: clickupColors.text,
                                          backgroundColor: clickupColors.background,
                                        }}
                                      >
                                        {ticket.clickupTaskStatus ?? "Linked"}
                                      </span>
                                    ) : (
                                      <span className="text-foreground">--</span>
                                    )}
                                  </div>
                                </div>
                              </div>
                            </button>
                            {index < tickets.length - 1 ? <Separator /> : null}
                          </div>
                        )
                      })
                    )}

                    {ticketTotalPages > 1 ? (
                      <div className="flex flex-col gap-3 pt-2">
                        <Separator />
                        <div className="flex flex-col items-center justify-between gap-3 text-xs text-muted-foreground md:flex-row">
                          <span>
                            Page {ticketsPage} of {ticketTotalPages} · {ticketTotalCount} records
                          </span>
                          <Pagination>
                            <PaginationContent>
                              <PaginationItem>
                                <PaginationPrevious
                                  href="#"
                                  aria-disabled={ticketsPage === 1}
                                  tabIndex={ticketsPage === 1 ? -1 : undefined}
                                  className={
                                    ticketsPage === 1
                                      ? "pointer-events-none opacity-50"
                                      : undefined
                                  }
                                  onClick={(event) => {
                                    event.preventDefault()
                                    if (ticketsPage > 1) {
                                      setTicketsPage(ticketsPage - 1)
                                    }
                                  }}
                                />
                              </PaginationItem>
                              {ticketPaginationItems.map((item, index) => (
                                <PaginationItem key={`${item}-${index}`}>
                                  {item === "ellipsis" ? (
                                    <PaginationEllipsis />
                                  ) : (
                                    <PaginationLink
                                      href="#"
                                      isActive={item === ticketsPage}
                                      onClick={(event) => {
                                        event.preventDefault()
                                        setTicketsPage(item)
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
                                  aria-disabled={ticketsPage === ticketTotalPages}
                                  tabIndex={
                                    ticketsPage === ticketTotalPages ? -1 : undefined
                                  }
                                  className={
                                    ticketsPage === ticketTotalPages
                                      ? "pointer-events-none opacity-50"
                                      : undefined
                                  }
                                  onClick={(event) => {
                                    event.preventDefault()
                                    if (ticketsPage < ticketTotalPages) {
                                      setTicketsPage(ticketsPage + 1)
                                    }
                                  }}
                                />
                              </PaginationItem>
                            </PaginationContent>
                          </Pagination>
                        </div>
                      </div>
                    ) : null}
                  </CardContent>
                </Card>
              </div>
            </>
          ) : null}
        </div>
      </div>

      <Dialog
        open={selectedTicketId !== null}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) {
            setSelectedTicketId(null)
            setTicketDetail(null)
            setDetailError(null)
          }
        }}
      >
        <DialogContent className="max-h-[90vh] w-[96vw] max-w-[1200px] overflow-y-auto p-0 md:w-[60vw]">
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
              detailError ? (
                <div className="text-destructive text-sm">{detailError}</div>
              ) : (
                <div className="text-muted-foreground text-sm">Loading ticket details...</div>
              )
            ) : (
              <div className="space-y-4 [&_[data-slot=card]]:gap-3 [&_[data-slot=card-header]]:gap-1">
                <div className="flex flex-wrap items-center gap-2">
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
                  <span className="inline-flex items-center rounded-full border px-3 py-1 text-xs">
                    Resolution time:{" "}
                    {getCloseDuration(ticketDetail.createdAt, selectedResolvedAt) ?? "--"}
                  </span>
                </div>

                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm">Contact information</CardTitle>
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
                        <div className="text-muted-foreground mb-1 text-xs">Merchant name</div>
                        <div className="bg-muted/40 rounded-md border px-3 py-2 text-sm">
                          {ticketDetail.merchantName ?? "--"}
                        </div>
                      </div>
                      <div>
                        <div className="text-muted-foreground mb-1 text-xs">Phone no.</div>
                        <div className="bg-muted/40 rounded-md border px-3 py-2 text-sm">
                          {ticketDetail.customerPhone ?? "--"}
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm">Ticket metadata</CardTitle>
                    <CardDescription>Identifiers, assignment, and status.</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-3 text-sm">
                    <div className="grid gap-2 md:grid-cols-2">
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
                    <div className="grid gap-2 md:grid-cols-2">
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
                    <CardTitle className="text-sm">Issue details</CardTitle>
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
                      <div className="text-muted-foreground mb-1 text-xs">Issue description</div>
                      <div className="bg-muted/40 min-h-[88px] rounded-md border px-3 py-2 text-sm whitespace-pre-wrap">
                        {ticketDetail.issueDescription ?? "--"}
                      </div>
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm">Internal notes</CardTitle>
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
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setSelectedTicketId(null)
                  setTicketDetail(null)
                  setDetailError(null)
                }}
              >
                Close
              </Button>
            </DialogFooter>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
