"use client"

import * as React from "react"
import { ChevronDown, ChevronRight, LoaderCircle, Upload } from "lucide-react"

import { formatDateTime as formatAppDateTime, parseDate } from "@/lib/dates"
import { getSessionUser } from "@/lib/session"
import { uploadFile } from "@/lib/upload-client"
import type { PlusPreviewRow, PlusUpdateSummary } from "@/lib/plus-import"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { ExternalLink } from "@/components/external-link"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
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
import { Separator } from "@/components/ui/separator"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { useToast } from "@/components/toast-provider"

type Merchant = {
  id: string
  external_id: string
  name: string
  fid: string | null
  outlet_count: number
  status: string | null
  created_at: string | null
  updated_at: string
  details: {
    company: string | null
    company_address: string | null
    country: string | null
    timezone_offset: string | null
    slug: string | null
    closed_account: boolean | null
    test_account: boolean | null
  }
}

type Outlet = {
  id: string
  external_id: string
  name: string
  status: string | null
  merchant_id?: string | null
  valid_until: string | null
  address?: string | null
  unit_no?: string | null
  latitude?: string | null
  longitude?: string | null
  maps_url?: string | null
  created_at?: string | null
  updated_at?: string
}

type BranchOption = {
  id: string
  code: string | null
  name: string
  group: string | null
  status: number | string | null
  isPrimary: boolean
}

type PreviewResponse = {
  jobId?: string
  rows: PlusPreviewRow[]
  totals: {
    totalRows: number
    readyCount: number
    skippedCount: number
  }
}

type JobStatusResponse = {
  job: {
    id: string
    status: "running" | "completed" | "failed"
    totalRows: number
    processedRows: number
    updatedCount: number
    skippedCount: number
    failedCount: number
    errorMessage: string | null
    startedAt: string
    finishedAt: string | null
  }
}

type ProgressState = {
  processed: number
  totalRows: number
  updatedCount: number
  skippedCount: number
  failedCount: number
  current: {
    fid: string
    status: string
    reason?: string | null
    merchantUpdated?: boolean
    categoryUpdated?: boolean
  } | null
}

const perPageOptions = [10, 25, 50, 100] as const
const statusOptions = [
  { value: "all", label: "All statuses" },
  { value: "live", label: "Live" },
  { value: "test", label: "Test" },
  { value: "closed", label: "Closed" },
] as const
const sortOptions = [
  { value: "fid-desc", label: "FID (desc)" },
  { value: "fid-asc", label: "FID (asc)" },
  { value: "name-asc", label: "Name (A-Z)" },
  { value: "name-desc", label: "Name (Z-A)" },
] as const

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

function formatDateTime(value: string | null) {
  if (!value) {
    return "--"
  }
  return formatAppDateTime(value)
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

function getProgressPercent(progress: ProgressState | null) {
  if (!progress || !progress.totalRows) {
    return 0
  }
  return Math.min(100, Math.round((progress.processed / progress.totalRows) * 100))
}

export default function PlusPage() {
  const { showToast } = useToast()
  const [merchants, setMerchants] = React.useState<Merchant[]>([])
  const [loading, setLoading] = React.useState(true)
  const [search, setSearch] = React.useState("")
  const [page, setPage] = React.useState(1)
  const [perPage, setPerPage] = React.useState(25)
  const [sortOption, setSortOption] =
    React.useState<(typeof sortOptions)[number]["value"]>("fid-desc")
  const [statusFilter, setStatusFilter] =
    React.useState<(typeof statusOptions)[number]["value"]>("all")
  const [branches, setBranches] = React.useState<BranchOption[]>([])
  const [branchesLoading, setBranchesLoading] = React.useState(false)
  const [selectedBranchId, setSelectedBranchId] = React.useState("all")
  const [totalCount, setTotalCount] = React.useState(0)
  const [lastUpdated, setLastUpdated] = React.useState<string | null>(null)
  const [expandedId, setExpandedId] = React.useState<string | null>(null)
  const [outletsByMerchant, setOutletsByMerchant] = React.useState<Record<string, Outlet[]>>({})
  const [loadingOutlets, setLoadingOutlets] = React.useState<Record<string, boolean>>({})

  const [dialogOpen, setDialogOpen] = React.useState(false)
  const [selectedFile, setSelectedFile] = React.useState<File | null>(null)
  const [jobId, setJobId] = React.useState<string | null>(null)
  const [uploadedKey, setUploadedKey] = React.useState<string | null>(null)
  const [preview, setPreview] = React.useState<PreviewResponse | null>(null)
  const [previewLoading, setPreviewLoading] = React.useState(false)
  const [previewError, setPreviewError] = React.useState<string | null>(null)
  const [runningUpdate, setRunningUpdate] = React.useState(false)
  const [progress, setProgress] = React.useState<ProgressState | null>(null)
  const [summary, setSummary] = React.useState<PlusUpdateSummary | null>(null)

  const totalPages = Math.max(1, Math.ceil(totalCount / perPage))
  const paginationItems = React.useMemo(
    () => getPaginationItems(page, totalPages),
    [page, totalPages]
  )

  const loadLatestPlusJob = React.useCallback(async () => {
    const user = getSessionUser()
    if (!user?.id) {
      return
    }

    try {
      const response = await fetch("/api/plus/jobs/latest", {
        headers: { "x-user-id": user.id },
      })
      if (!response.ok) {
        return
      }

      const data = (await response.json()) as {
        job?: { finished_at: string | null; started_at: string } | null
      }
      setLastUpdated(data.job?.finished_at ?? null)
    } catch (error) {
      console.error(error)
    }
  }, [])

  const selectedBranch = React.useMemo(
    () => branches.find((branch) => branch.id === selectedBranchId) ?? null,
    [branches, selectedBranchId]
  )

  const loadMerchants = React.useCallback(async () => {
    const user = getSessionUser()
    if (!user?.id) {
      setLoading(false)
      return
    }

    setLoading(true)
    try {
      const [sortField, sortDirection] = sortOption.split("-")
      const params = new URLSearchParams()
      params.set("page", String(page))
      params.set("per_page", String(perPage))
      params.set("sort", sortField)
      params.set("direction", sortDirection)
      params.set("status", statusFilter)
      if (selectedBranchId !== "all" && selectedBranch) {
        params.set("branch_id", selectedBranchId)
      } else {
        params.set("branch_group", "PLUS")
      }
      if (search.trim()) {
        params.set("q", search.trim())
      }

      const response = await fetch(`/api/merchants?${params.toString()}`, {
        headers: { "x-user-id": user.id },
      })
      if (!response.ok) {
        throw new Error("Unable to load PLUS merchants.")
      }

      const data = (await response.json()) as {
        merchants: Merchant[]
        total: number
      }
      setMerchants(data.merchants ?? [])
      setTotalCount(data.total ?? 0)
    } catch (error) {
      console.error(error)
      showToast("Unable to load PLUS merchants.", "error")
    } finally {
      setLoading(false)
    }
  }, [
    page,
    perPage,
    search,
    selectedBranch,
    selectedBranchId,
    statusFilter,
    showToast,
    sortOption,
  ])

  React.useEffect(() => {
    void loadMerchants()
  }, [loadMerchants])

  React.useEffect(() => {
    void loadLatestPlusJob()
  }, [loadLatestPlusJob])

  React.useEffect(() => {
    setExpandedId(null)
  }, [page, perPage, search, selectedBranchId, sortOption, statusFilter])

  React.useEffect(() => {
    if (page > totalPages) {
      setPage(totalPages)
    }
  }, [page, totalPages])

  React.useEffect(() => {
    const user = getSessionUser()
    if (!user?.id) {
      return
    }

    let cancelled = false

    const loadBranches = async () => {
      setBranchesLoading(true)
      try {
        const response = await fetch("/api/plus/branches", {
          headers: { "x-user-id": user.id },
        })
        if (!response.ok) {
          throw new Error("Unable to load PLUS branches.")
        }
        const data = (await response.json()) as { branches?: BranchOption[] }
        if (!cancelled) {
          setBranches(data.branches ?? [])
        }
      } catch (error) {
        console.error(error)
        if (!cancelled) {
          setBranches([])
          showToast("Unable to load PLUS branches.", "error")
        }
      } finally {
        if (!cancelled) {
          setBranchesLoading(false)
        }
      }
    }

    void loadBranches()

    return () => {
      cancelled = true
    }
  }, [showToast])

  const loadOutlets = React.useCallback(
    async (merchantId: string) => {
      const user = getSessionUser()
      if (!user?.id || loadingOutlets[merchantId] || outletsByMerchant[merchantId]) {
        return
      }

      setLoadingOutlets((prev) => ({ ...prev, [merchantId]: true }))
      try {
        const response = await fetch(`/api/merchants/${merchantId}/outlets`, {
          headers: { "x-user-id": user.id },
        })
        if (!response.ok) {
          throw new Error("Unable to load outlets.")
        }
        const data = (await response.json()) as { outlets: Outlet[] }
        setOutletsByMerchant((prev) => ({
          ...prev,
          [merchantId]: data.outlets ?? [],
        }))
      } catch (error) {
        console.error(error)
        showToast("Unable to load outlets.", "error")
      } finally {
        setLoadingOutlets((prev) => ({ ...prev, [merchantId]: false }))
      }
    },
    [loadingOutlets, outletsByMerchant, showToast]
  )

  const handleToggle = (merchantId: string) => {
    const nextId = expandedId === merchantId ? null : merchantId
    setExpandedId(nextId)
    if (nextId) {
      void loadOutlets(nextId)
    }
  }

  const handlePageChange = (nextPage: number) => {
    if (nextPage < 1 || nextPage > totalPages) {
      return
    }
    setPage(nextPage)
  }

  const resetDialogState = React.useCallback(async () => {
    const user = getSessionUser()
    const keyToCleanup = uploadedKey

    setSelectedFile(null)
    setJobId(null)
    setUploadedKey(null)
    setPreview(null)
    setPreviewError(null)
    setPreviewLoading(false)
    setRunningUpdate(false)
    setProgress(null)
    setSummary(null)

    if (keyToCleanup && user?.id) {
      await fetch("/api/plus/cleanup", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-user-id": user.id,
        },
        body: JSON.stringify({ key: keyToCleanup }),
      }).catch(() => undefined)
    }
  }, [uploadedKey])

  const handleDialogOpenChange = React.useCallback(
    (nextOpen: boolean) => {
      if (!nextOpen && runningUpdate) {
        return
      }
      setDialogOpen(nextOpen)
      if (!nextOpen) {
        void resetDialogState()
      }
    },
    [resetDialogState, runningUpdate]
  )

  const handlePreview = async () => {
    const user = getSessionUser()
    if (!user?.id || !selectedFile) {
      showToast("Select a template first.", "error")
      return
    }

    setPreviewLoading(true)
    setPreviewError(null)
    setSummary(null)
    setProgress(null)

    try {
      const upload = await uploadFile({
        file: selectedFile,
        folder: "uploads",
        userId: user.id,
      })
      setUploadedKey(upload.key)

      const response = await fetch("/api/plus/update/upload", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-user-id": user.id,
        },
        body: JSON.stringify({ key: upload.key }),
      })
      const data = (await response.json()) as PreviewResponse & { error?: string }
      if (!response.ok) {
        throw new Error(data.error ?? "Unable to preview PLUS template.")
      }
      setJobId(data.jobId ?? null)
      setPreview(data)
    } catch (error) {
      console.error(error)
      setPreviewError(error instanceof Error ? error.message : "Unable to preview PLUS template.")
      showToast("Unable to preview PLUS template.", "error")
    } finally {
      setPreviewLoading(false)
    }
  }

  const handleRunUpdate = async () => {
    const user = getSessionUser()
    if (!user?.id || !jobId || !preview) {
      showToast("Load a preview first.", "error")
      return
    }

    setRunningUpdate(true)
    setSummary(null)
    setProgress({
      processed: 0,
      totalRows: preview.totals.totalRows,
      updatedCount: 0,
      skippedCount: 0,
      failedCount: 0,
      current: null,
    })

    try {
      const response = await fetch(`/api/plus/update/${jobId}/start`, {
        method: "POST",
        headers: {
          "x-user-id": user.id,
        },
      })

      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { error?: string } | null
        throw new Error(payload?.error ?? "Unable to start PLUS update.")
      }

      let finished = false
      while (!finished) {
        await new Promise((resolve) => setTimeout(resolve, 1500))
        const statusResponse = await fetch(`/api/plus/update/${jobId}/status`, {
          headers: { "x-user-id": user.id },
        })
        const statusPayload = (await statusResponse.json()) as JobStatusResponse & {
          error?: string
        }
        if (!statusResponse.ok) {
          throw new Error(statusPayload.error ?? "Unable to load PLUS job status.")
        }

        setProgress({
          processed: statusPayload.job.processedRows,
          totalRows: statusPayload.job.totalRows,
          updatedCount: statusPayload.job.updatedCount,
          skippedCount: statusPayload.job.skippedCount,
          failedCount: statusPayload.job.failedCount,
          current: null,
        })

        if (statusPayload.job.status === "failed") {
          const summaryResponse = await fetch(`/api/plus/update/${jobId}/summary`, {
            headers: { "x-user-id": user.id },
          })
          const summaryPayload = (await summaryResponse.json()) as {
            summary?: PlusUpdateSummary | null
          }
          if (summaryPayload.summary) {
            setSummary(summaryPayload.summary)
          }
          throw new Error(statusPayload.job.errorMessage ?? "PLUS update failed.")
        }

        if (statusPayload.job.status === "completed") {
          const summaryResponse = await fetch(`/api/plus/update/${jobId}/summary`, {
            headers: { "x-user-id": user.id },
          })
          const summaryPayload = (await summaryResponse.json()) as {
            summary?: PlusUpdateSummary | null
          }
          if (!summaryPayload.summary) {
            throw new Error("PLUS update finished without a summary.")
          }
          setSummary(summaryPayload.summary)
          setUploadedKey(null)
          finished = true
        }
      }

      showToast("PLUS update completed.")
      await loadMerchants()
      await loadLatestPlusJob()
    } catch (error) {
      console.error(error)
      showToast(
        error instanceof Error ? error.message : "Unable to run PLUS update.",
        "error"
      )
    } finally {
      setRunningUpdate(false)
    }
  }

  return (
    <div className="animate-in fade-in slide-in-from-bottom-2 flex flex-col gap-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">PLUS</h1>
          <p className="text-muted-foreground text-sm">
            Merchants scoped to branch group PLUS with contract update tooling.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-muted-foreground text-sm">
            Last updated: {formatDateTime(lastUpdated)}
          </span>
          <Button onClick={() => setDialogOpen(true)}>
            <Upload className="mr-2 size-4" />
            Update PLUS
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader className="space-y-3">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <CardTitle className="text-base">PLUS franchise list</CardTitle>
            <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
              <div className="flex items-center gap-2">
                <span>Sort by</span>
                <Select
                  value={sortOption}
                  onValueChange={(value) => {
                    setSortOption(value as (typeof sortOptions)[number]["value"])
                    setPage(1)
                  }}
                >
                  <SelectTrigger className="h-8 w-[140px] text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {sortOptions.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-center gap-2">
                <span>Records per page</span>
                <Select
                  value={String(perPage)}
                  onValueChange={(value) => {
                    setPerPage(Number(value))
                    setPage(1)
                  }}
                >
                  <SelectTrigger className="h-8 w-[96px] text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {perPageOptions.map((option) => (
                      <SelectItem key={option} value={String(option)}>
                        {option}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
          <div className="flex flex-col gap-3 md:flex-row md:items-center">
            <div className="md:min-w-0 md:flex-1">
              <Input
                placeholder="Search by franchise or FID"
                value={search}
                onChange={(event) => {
                  setSearch(event.target.value)
                  setPage(1)
                }}
              />
            </div>
          </div>
          <div className="flex flex-col gap-3 md:flex-row md:items-center">
            <div className="md:w-48 md:flex-none">
              <Select
                value={statusFilter}
                onValueChange={(value) => {
                  setStatusFilter(value as (typeof statusOptions)[number]["value"])
                  setPage(1)
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Filter by status" />
                </SelectTrigger>
                <SelectContent>
                  {statusOptions.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="md:min-w-0 md:flex-1">
              <Select
                  value={selectedBranchId}
                  onValueChange={(value) => {
                    setSelectedBranchId(value)
                    setPage(1)
                  }}
                >
                  <SelectTrigger>
                  <SelectValue
                    placeholder={branchesLoading ? "Loading branches..." : "Filter by branch"}
                  />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All PLUS branches</SelectItem>
                  {branches.map((branch) => (
                    <SelectItem key={branch.id} value={branch.id}>
                      {branch.name}
                    </SelectItem>
                  ))}
                </SelectContent>
                </Select>
            </div>
            <Button
              type="button"
              variant="outline"
              className="md:flex-none"
              onClick={() => {
                setStatusFilter("all")
                setSelectedBranchId("all")
                setPage(1)
              }}
            >
              Clear
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {loading ? (
            <div className="text-muted-foreground text-sm">Loading PLUS merchants...</div>
          ) : null}
          {!loading && merchants.length === 0 ? (
            <div className="text-muted-foreground text-sm">
              No PLUS merchants found.
            </div>
          ) : null}
          {merchants.map((merchant, index) => (
            <div key={merchant.id} className="space-y-3">
              <Collapsible
                open={expandedId === merchant.id}
                onOpenChange={() => handleToggle(merchant.id)}
              >
                <CollapsibleTrigger asChild>
                  <button
                    type="button"
                    className="hover:bg-muted/40 flex w-full flex-col gap-2 rounded-lg px-2 py-2 text-left transition"
                  >
                    <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                      <div>
                        <div className="text-sm font-semibold">{merchant.name}</div>
                        <div className="text-muted-foreground text-xs">
                          {merchant.fid ? (
                            <ExternalLink
                              href={`https://cloud.getslurp.com/batcave/franchise/${merchant.fid}`}
                            >
                              {merchant.fid}
                            </ExternalLink>
                          ) : (
                            "FID pending"
                          )}{" "}
                          · {merchant.outlet_count} outlets
                        </div>
                      </div>
                      <span className="text-muted-foreground flex items-center gap-2 text-xs">
                        {expandedId === merchant.id ? (
                          <ChevronDown className="h-4 w-4" />
                        ) : (
                          <ChevronRight className="h-4 w-4" />
                        )}
                        <span>{expandedId === merchant.id ? "Collapse" : "Expand"}</span>
                      </span>
                    </div>
                  </button>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <div className="bg-muted/30 mt-2 space-y-4 rounded-lg border px-4 py-4 text-sm">
                    <div className="grid gap-3 md:grid-cols-2">
                      <div>
                        <div className="text-muted-foreground text-xs">Company</div>
                        <div className="font-medium">
                          {merchant.details.company ?? merchant.details.slug ?? "—"}
                        </div>
                      </div>
                      <div>
                        <div className="text-muted-foreground text-xs">
                          Company address
                        </div>
                        <div className="font-medium">
                          {merchant.details.company_address ?? "—"}
                        </div>
                      </div>
                      <div>
                        <div className="text-muted-foreground text-xs">
                          Account status
                        </div>
                        <div className="font-medium">
                          {merchant.details.closed_account ? "Closed" : "Open"}
                        </div>
                      </div>
                      <div>
                        <div className="text-muted-foreground text-xs">Created at</div>
                        <div className="font-medium">
                          {merchant.created_at ? formatDateTime(merchant.created_at) : "—"}
                        </div>
                      </div>
                    </div>

                    <Separator />

                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <div className="text-sm font-semibold">Outlets</div>
                        <span className="text-muted-foreground text-xs">
                          {loadingOutlets[merchant.id]
                            ? "Loading..."
                            : `${outletsByMerchant[merchant.id]?.length ?? 0} outlets`}
                        </span>
                      </div>
                      {loadingOutlets[merchant.id] ? (
                        <div className="text-muted-foreground text-xs">
                          Fetching outlet details...
                        </div>
                      ) : outletsByMerchant[merchant.id]?.length ? (
                        outletsByMerchant[merchant.id]?.map((outlet) => (
                          <div
                            key={outlet.external_id}
                            className="rounded-md border px-3 py-2"
                          >
                            <div className="flex flex-col gap-1 md:flex-row md:items-center md:justify-between">
                              <div>
                                <div className="font-medium">{outlet.name}</div>
                              </div>
                              {(() => {
                                const statusLabel = getOutletStatusLabel(outlet.valid_until)
                                return (
                                  <span
                                    className={[
                                      "rounded-full px-2.5 py-1 text-xs font-medium",
                                      getOutletStatusClasses(statusLabel),
                                    ].join(" ")}
                                  >
                                    {statusLabel}
                                  </span>
                                )
                              })()}
                            </div>
                            <div className="mt-2 grid gap-2 text-xs text-muted-foreground md:grid-cols-2">
                              <div>
                                <span className="block text-[11px] uppercase tracking-wide">
                                  OID
                                </span>
                                <span className="text-foreground">
                                  {outlet.external_id}
                                </span>
                              </div>
                              <div>
                                <span className="block text-[11px] uppercase tracking-wide">
                                  Merchant ID
                                </span>
                                <span className="text-foreground">
                                  {outlet.merchant_id ?? "—"}
                                </span>
                              </div>
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
                                  {outlet.valid_until ? formatDateTime(outlet.valid_until) : "—"}
                                </span>
                              </div>
                              <div>
                                <span className="block text-[11px] uppercase tracking-wide">
                                  Created at
                                </span>
                                <span className="text-foreground">
                                  {outlet.created_at ? formatDateTime(outlet.created_at) : "—"}
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
                        ))
                      ) : (
                        <div className="text-muted-foreground text-xs">
                          No outlets found.
                        </div>
                      )}
                    </div>
                  </div>
                </CollapsibleContent>
              </Collapsible>
              {index < merchants.length - 1 ? <Separator /> : null}
            </div>
          ))}
          {totalPages > 1 ? (
            <div className="flex flex-col gap-3 pt-2">
              <Separator />
              <div className="flex flex-col items-center justify-between gap-3 text-xs text-muted-foreground md:flex-row">
                <span>
                  Page {page} of {totalPages} · {totalCount} records
                </span>
                <Pagination>
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
                              handlePageChange(item)
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
              </div>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={handleDialogOpenChange}>
        <DialogContent className="max-h-[90vh] max-w-5xl overflow-hidden">
          <DialogHeader>
            <DialogTitle>Update PLUS</DialogTitle>
            <DialogDescription>
              Upload the renewed contract template, review the detected mappings, then run the OID 1 update.
            </DialogDescription>
          </DialogHeader>

          <div className="min-h-0 flex-1 overflow-y-auto pr-1">
            {!preview && !summary ? (
              <div className="space-y-4">
                <div className="rounded-xl border border-dashed p-6">
                  <div className="mb-3 text-sm font-medium">Import file</div>
                  <Input
                    type="file"
                    accept=".csv,.xlsx,.xls"
                    onChange={(event) => {
                      const file = event.target.files?.[0] ?? null
                      setSelectedFile(file)
                      setPreview(null)
                      setPreviewError(null)
                    }}
                  />
                  <div className="text-muted-foreground mt-3 text-xs">
                    Expected template: Terminal ID = FID, old values from old contract columns, new values from new contract columns.
                  </div>
                </div>
                {previewError ? (
                  <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-700 dark:text-rose-300">
                    {previewError}
                  </div>
                ) : null}
              </div>
            ) : null}

            {preview ? (
              <div className="space-y-4">
                <div className="grid gap-3 md:grid-cols-3">
                  <div className="rounded-xl border p-4">
                    <div className="text-muted-foreground text-xs">Rows in file</div>
                    <div className="mt-1 text-2xl font-semibold">{preview.totals.totalRows}</div>
                  </div>
                  <div className="rounded-xl border p-4">
                    <div className="text-muted-foreground text-xs">Ready to update</div>
                    <div className="mt-1 text-2xl font-semibold text-emerald-700 dark:text-emerald-300">
                      {preview.totals.readyCount}
                    </div>
                  </div>
                  <div className="rounded-xl border p-4">
                    <div className="text-muted-foreground text-xs">Will be skipped</div>
                    <div className="mt-1 text-2xl font-semibold text-amber-700 dark:text-amber-300">
                      {preview.totals.skippedCount}
                    </div>
                  </div>
                </div>

                <div className="overflow-auto rounded-xl border">
                  <table className="min-w-full text-sm">
                    <thead className="bg-muted/40 text-left">
                      <tr>
                        <th className="px-3 py-2">FID</th>
                        <th className="px-3 py-2">Merchant</th>
                        <th className="px-3 py-2">DB Contract ID</th>
                        <th className="px-3 py-2">New Contract ID</th>
                        <th className="px-3 py-2">Existing category</th>
                        <th className="px-3 py-2">New category</th>
                        <th className="px-3 py-2">Mapped category</th>
                        <th className="px-3 py-2">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {preview.rows.map((row) => (
                        <tr key={`${row.fid}-${row.rowNumber}`} className="border-t align-top">
                          <td className="px-3 py-2">{row.fid}</td>
                          <td className="px-3 py-2">
                            <div className="font-medium">{row.merchantName ?? row.tenantName}</div>
                            <div className="text-muted-foreground text-xs">
                              {row.outletName ?? "OID 1"}
                            </div>
                          </td>
                          <td className="px-3 py-2">{row.currentMerchantId ?? "--"}</td>
                          <td className="px-3 py-2">{row.newMerchantId || "--"}</td>
                          <td className="px-3 py-2">{row.oldCategoryText || "--"}</td>
                          <td className="px-3 py-2">{row.newCategoryText || "--"}</td>
                          <td className="px-3 py-2">
                            {row.resolvedCategoryBusinessLabel
                              ? `${row.resolvedCategoryBusinessLabel} (${row.resolvedCategoryBusinessId})`
                              : "--"}
                          </td>
                          <td className="px-3 py-2">
                            <div
                              className={[
                                "inline-flex rounded-full px-2 py-1 text-xs font-medium",
                                row.status === "ready"
                                  ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                                  : "bg-amber-500/10 text-amber-700 dark:text-amber-300",
                              ].join(" ")}
                            >
                              {row.status === "ready" ? "Ready" : row.reason ?? "Skipped"}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : null}

            {runningUpdate ? (
              <div className="space-y-4">
                <div className="rounded-xl border p-4">
                  <div className="mb-2 flex items-center justify-between text-sm">
                    <span>Update progress</span>
                    <span className="text-muted-foreground">
                      {progress?.processed ?? summary?.processed ?? 0} / {progress?.totalRows ?? summary?.totalRows ?? 0}
                    </span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full bg-primary transition-all"
                      style={{ width: `${getProgressPercent(progress) || getProgressPercent(summary ? {
                        processed: summary.processed,
                        totalRows: summary.totalRows,
                        updatedCount: summary.updatedCount,
                        skippedCount: summary.skippedCount,
                        failedCount: summary.failedCount,
                        current: null,
                      } : null)}%` }}
                    />
                  </div>
                  <div className="mt-3 grid gap-3 md:grid-cols-3">
                    <div className="rounded-lg border px-3 py-2 text-sm">
                      <div className="text-muted-foreground text-xs">Updated</div>
                      <div className="font-semibold">
                        {progress?.updatedCount ?? summary?.updatedCount ?? 0}
                      </div>
                    </div>
                    <div className="rounded-lg border px-3 py-2 text-sm">
                      <div className="text-muted-foreground text-xs">Skipped</div>
                      <div className="font-semibold">
                        {progress?.skippedCount ?? summary?.skippedCount ?? 0}
                      </div>
                    </div>
                    <div className="rounded-lg border px-3 py-2 text-sm">
                      <div className="text-muted-foreground text-xs">Failed</div>
                      <div className="font-semibold">
                        {progress?.failedCount ?? summary?.failedCount ?? 0}
                      </div>
                    </div>
                  </div>
                  {runningUpdate && progress?.current ? (
                    <div className="text-muted-foreground mt-3 text-sm">
                      Processing FID {progress.current.fid}: {progress.current.status}
                      {progress.current.reason ? ` (${progress.current.reason})` : ""}
                    </div>
                  ) : null}
                </div>
              </div>
            ) : null}

            {summary ? (
              <div className="space-y-4">
                <div className="rounded-xl border p-4">
                  <div className="text-base font-semibold">Update summary</div>
                  <div className="text-muted-foreground mt-1 text-sm">
                    {summary.updatedCount} franchise(s) updated, {summary.skippedCount} skipped, {summary.failedCount} failed.
                  </div>
                </div>

                <div className="max-h-[46vh] space-y-4 overflow-y-auto rounded-xl border p-4">
                  {summary.skipped.length ? (
                    <div className="space-y-2">
                      <div className="font-medium">Skipped franchises</div>
                      <div className="space-y-2 text-sm">
                        {summary.skipped.map((item) => (
                          <div key={`skipped-${item.fid}-${item.rowNumber}`} className="rounded-lg border px-3 py-2">
                            <div className="font-medium">
                              FID {item.fid} {item.merchantName ? `• ${item.merchantName}` : ""}
                            </div>
                            <div className="text-muted-foreground">{item.reason}</div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : null}

                  {summary.failed.length ? (
                    <div className="space-y-2">
                      <div className="font-medium">Failed franchises</div>
                      <div className="space-y-2 text-sm">
                        {summary.failed.map((item) => (
                          <div key={`failed-${item.fid}-${item.rowNumber}`} className="rounded-lg border px-3 py-2">
                            <div className="font-medium">
                              FID {item.fid} {item.merchantName ? `• ${item.merchantName}` : ""}
                            </div>
                            <div className="text-muted-foreground">{item.reason}</div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : null}

                  {!summary.skipped.length && !summary.failed.length ? (
                    <div className="text-muted-foreground text-sm">
                      No skipped or failed franchises in this run.
                    </div>
                  ) : null}
                </div>
              </div>
            ) : null}
          </div>

          <DialogFooter>
            {summary ? (
              <Button onClick={() => handleDialogOpenChange(false)}>Close</Button>
            ) : preview ? (
              <>
                <Button variant="outline" onClick={() => handleDialogOpenChange(false)} disabled={runningUpdate}>
                  Cancel
                </Button>
                <Button
                  onClick={() => void handleRunUpdate()}
                  disabled={runningUpdate || preview.totals.readyCount === 0}
                >
                  {runningUpdate ? (
                    <>
                      <LoaderCircle className="mr-2 size-4 animate-spin" />
                      Updating...
                    </>
                  ) : (
                    "Continue"
                  )}
                </Button>
              </>
            ) : (
              <>
                <Button variant="outline" onClick={() => handleDialogOpenChange(false)} disabled={previewLoading}>
                  Cancel
                </Button>
                <Button onClick={() => void handlePreview()} disabled={!selectedFile || previewLoading}>
                  {previewLoading ? (
                    <>
                      <LoaderCircle className="mr-2 size-4 animate-spin" />
                      Loading preview...
                    </>
                  ) : (
                    "Upload template"
                  )}
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
