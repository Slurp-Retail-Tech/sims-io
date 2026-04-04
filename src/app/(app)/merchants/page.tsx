"use client"

import * as React from "react"
import Link from "next/link"

import { formatDateTime } from "@/lib/dates"
import { getOutletStatusClasses, getOutletStatusLabel } from "@/lib/outlet-map"
import { ChevronDown, ChevronRight, Download, LoaderCircle } from "lucide-react"
import { getSessionUser } from "@/lib/session"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
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
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Separator } from "@/components/ui/separator"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { ExternalLink } from "@/components/external-link"
import { useToast } from "@/components/toast-provider"

type Merchant = {
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
  }
}

type ImportRun = {
  id: string
  status: "running" | "success" | "failed"
  started_at: string
  completed_at: string | null
  records_imported: number
  error_message: string | null
}

type BranchOption = {
  id: string
  code: string | null
  name: string
  group: string | null
  status: number | string | null
  isPrimary: boolean
}

const DEFAULT_BRANCH_GROUP = "Slurp"

type Outlet = {
  id: string
  external_id: string
  name: string
  status: string | null
  address: string | null
  unit_no: string | null
  latitude: string | null
  longitude: string | null
  maps_url: string | null
  valid_until: string | null
  created_at: string | null
  updated_at: string
}

function formatLastUpdated(value: string | null) {
  if (!value) {
    return "Last updated: --"
  }
  return `Last updated: ${formatDateTime(value)}`
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

export default function MerchantsPage() {
  const [merchants, setMerchants] = React.useState<Merchant[]>([])
  const [loading, setLoading] = React.useState(true)
  const [search, setSearch] = React.useState("")
  const [statusFilter, setStatusFilter] =
    React.useState<(typeof statusOptions)[number]["value"]>("all")
  const [branches, setBranches] = React.useState<BranchOption[]>([])
  const [branchesLoading, setBranchesLoading] = React.useState(false)
  const [selectedBranchGroup, setSelectedBranchGroup] = React.useState("all")
  const [selectedBranchId, setSelectedBranchId] = React.useState("all")
  const [page, setPage] = React.useState(1)
  const [perPage, setPerPage] = React.useState(25)
  const [sortOption, setSortOption] =
    React.useState<(typeof sortOptions)[number]["value"]>("fid-desc")
  const [totalCount, setTotalCount] = React.useState(0)
  const [lastUpdated, setLastUpdated] = React.useState<string | null>(null)
  const [isImporting, setIsImporting] = React.useState(false)
  const [importRun, setImportRun] = React.useState<ImportRun | null>(null)
  const [expandedId, setExpandedId] = React.useState<string | null>(null)
  const [outletsByMerchant, setOutletsByMerchant] = React.useState<
    Record<string, Outlet[]>
  >({})
  const [loadingOutlets, setLoadingOutlets] = React.useState<
    Record<string, boolean>
  >({})
  const { showToast } = useToast()
  const pollRef = React.useRef<ReturnType<typeof setInterval> | null>(null)
  const [exportLoading, setExportLoading] = React.useState(false)

  const handleExport = React.useCallback(
    async (format: "csv" | "xlsx" | "pdf") => {
      const user = getSessionUser()
      if (!user?.id || exportLoading) return

      setExportLoading(true)
      try {
        const params = new URLSearchParams()
        params.set("format", format)
        if (search.trim()) params.set("q", search.trim())
        if (statusFilter !== "all") params.set("status", statusFilter)
        if (selectedBranchGroup !== "all" && selectedBranchId === "all") {
          params.set("branch_group", selectedBranchGroup)
        }
        if (selectedBranchId !== "all") {
          params.set("branch_id", selectedBranchId)
        }

        const response = await fetch(`/api/merchants/export?${params.toString()}`, {
        })
        if (!response.ok) {
          throw new Error("Unable to export merchants.")
        }
        const blob = await response.blob()
        const contentDisposition = response.headers.get("Content-Disposition") ?? ""
        const filenameMatch = contentDisposition.match(/filename="([^"]+)"/)
        const filename = filenameMatch?.[1] ?? `merchants-export.${format}`
        const url = URL.createObjectURL(blob)
        const anchor = document.createElement("a")
        anchor.href = url
        anchor.download = filename
        document.body.appendChild(anchor)
        anchor.click()
        anchor.remove()
        URL.revokeObjectURL(url)
      } catch (error) {
        console.error(error)
        showToast("Unable to export merchants.", "error")
      } finally {
        setExportLoading(false)
      }
    },
    [exportLoading, search, statusFilter, selectedBranchGroup, selectedBranchId, showToast]
  )

  const branchGroups = React.useMemo(() => {
    const groups = Array.from(
      new Set(
        [DEFAULT_BRANCH_GROUP, ...branches.map((branch) => branch.group?.trim())].filter(
          (value): value is string => Boolean(value)
        )
      )
    ).filter((group) => group !== DEFAULT_BRANCH_GROUP)

    return [
      DEFAULT_BRANCH_GROUP,
      ...groups.sort((left, right) => left.localeCompare(right)),
    ]
  }, [branches])

  const groupedBranches = React.useMemo(() => {
    return branchGroups
      .map((group) => ({
        group,
        branches: branches
          .filter(
            (branch) => (branch.group?.trim() || DEFAULT_BRANCH_GROUP) === group
          )
          .sort((left, right) => left.name.localeCompare(right.name)),
      }))
      .filter((entry) => entry.branches.length > 0)
  }, [branchGroups, branches])

  const selectedBranch = React.useMemo(
    () => branches.find((branch) => branch.id === selectedBranchId) ?? null,
    [branches, selectedBranchId]
  )

  const selectedBranchFilterValue = React.useMemo(() => {
    if (selectedBranchId !== "all") {
      return `branch:${selectedBranchId}`
    }
    if (selectedBranchGroup !== "all") {
      return `group:${selectedBranchGroup}`
    }
    return "all"
  }, [selectedBranchGroup, selectedBranchId])

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
      if (search.trim()) {
        params.set("q", search.trim())
      }
      if (selectedBranchGroup !== "all" && selectedBranchId === "all") {
        params.set("branch_group", selectedBranchGroup)
      }
      if (selectedBranchId !== "all" && selectedBranch) {
        params.set("branch_id", selectedBranch.id)
      }

      const response = await fetch(`/api/merchants?${params.toString()}`, {
      })
      if (!response.ok) {
        showToast("Unable to load merchants.", "error")
        return
      }
      const data = (await response.json()) as {
        merchants: Merchant[]
        lastUpdated: string | null
        total: number
      }
      setMerchants(data.merchants ?? [])
      setLastUpdated(data.lastUpdated ?? null)
      setTotalCount(data.total ?? 0)
    } catch (error) {
      console.error(error)
      showToast("Unable to load merchants.", "error")
    } finally {
      setLoading(false)
    }
  }, [
    page,
    perPage,
    search,
    selectedBranch,
    selectedBranchGroup,
    selectedBranchId,
    showToast,
    sortOption,
    statusFilter,
  ])

  React.useEffect(() => {
    void loadMerchants()
  }, [loadMerchants])

  React.useEffect(() => {
    setExpandedId(null)
  }, [
    page,
    perPage,
    search,
    selectedBranchGroup,
    selectedBranchId,
    sortOption,
    statusFilter,
  ])

  React.useEffect(() => {
    const user = getSessionUser()
    if (!user?.id) {
      return
    }

    let cancelled = false

    const loadBranches = async () => {
      setBranchesLoading(true)
      try {
        const response = await fetch("/api/branches", {
        })
        if (!response.ok) {
          showToast("Unable to load branches.", "error")
          return
        }
        const data = (await response.json()) as { branches?: BranchOption[] }
        if (!cancelled) {
          setBranches(data.branches ?? [])
        }
      } catch (error) {
        console.error(error)
        if (!cancelled) {
          showToast("Unable to load branches.", "error")
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

  const loadImportStatus = React.useCallback(async () => {
    const user = getSessionUser()
    if (!user?.id) {
      return
    }
    try {
      const response = await fetch("/api/merchants/import/status", {
      })
      if (!response.ok) {
        return
      }
      const data = (await response.json()) as { run: ImportRun | null }
      setImportRun(data.run)
    } catch (error) {
      console.error(error)
    }
  }, [])

  React.useEffect(() => {
    void loadImportStatus()
  }, [loadImportStatus])

  React.useEffect(() => {
    if (importRun?.status === "running" || isImporting) {
      if (!pollRef.current) {
        pollRef.current = setInterval(() => {
          void loadImportStatus()
        }, 2000)
      }
      return
    }
    if (pollRef.current) {
      clearInterval(pollRef.current)
      pollRef.current = null
    }
  }, [importRun?.status, isImporting, loadImportStatus])

  React.useEffect(() => {
    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current)
        pollRef.current = null
      }
    }
  }, [])

  const handleImport = async () => {
    const user = getSessionUser()
    if (!user?.id) {
      showToast("Please log in to import.", "error")
      return
    }
    setIsImporting(true)
    try {
      void loadImportStatus()
      const response = await fetch("/api/merchants/import", {
        method: "POST",
      })
      if (!response.ok) {
        const data = (await response.json()) as { error?: string }
        showToast(data.error ?? "Import failed.", "error")
        return
      }
      showToast("Import completed.")
      await loadMerchants()
      await loadImportStatus()
    } catch (error) {
      console.error(error)
      showToast("Import failed.", "error")
    } finally {
      setIsImporting(false)
    }
  }

  const loadOutlets = React.useCallback(
    async (merchantKey: string, merchantFid: string | null) => {
      const user = getSessionUser()
      if (!user?.id) {
        return
      }
      if (!merchantFid) {
        return
      }
      if (loadingOutlets[merchantKey] || outletsByMerchant[merchantKey]) {
        return
      }
      setLoadingOutlets((prev) => ({ ...prev, [merchantKey]: true }))
      try {
        const response = await fetch(
          `/api/merchants/${merchantFid}/outlets`
        )
        if (!response.ok) {
          showToast("Unable to load outlets.", "error")
          return
        }
        const data = (await response.json()) as { outlets: Outlet[] }
        setOutletsByMerchant((prev) => ({
          ...prev,
          [merchantKey]: data.outlets ?? [],
        }))
      } catch (error) {
        console.error(error)
        showToast("Unable to load outlets.", "error")
      } finally {
        setLoadingOutlets((prev) => ({ ...prev, [merchantKey]: false }))
      }
    },
    [loadingOutlets, outletsByMerchant, showToast]
  )

  const handleToggle = (merchantId: string, merchantFid: string | null) => {
    const nextId = expandedId === merchantId ? null : merchantId
    setExpandedId(nextId)
    if (nextId && merchantFid) {
      void loadOutlets(nextId, merchantFid)
    }
  }

  const totalPages = Math.max(1, Math.ceil(totalCount / perPage))
  const paginationItems = React.useMemo(
    () => getPaginationItems(page, totalPages),
    [page, totalPages]
  )

  React.useEffect(() => {
    if (page > totalPages) {
      setPage(totalPages)
    }
  }, [page, totalPages])

  const handleSearchChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    setSearch(event.target.value)
    setPage(1)
  }

  const handlePageChange = (nextPage: number) => {
    if (nextPage < 1 || nextPage > totalPages) {
      return
    }
    setPage(nextPage)
  }

  return (
    <div className="animate-in fade-in slide-in-from-bottom-2 flex flex-col gap-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Merchants</h1>
          <p className="text-muted-foreground text-sm">
            Franchise and outlet details synced from Slurp! Cloud.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <span className="text-muted-foreground">
            {formatLastUpdated(lastUpdated)}
          </span>
          {importRun?.status === "running" ? (
            <span className="text-muted-foreground flex items-center gap-2 text-xs">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary/60 opacity-75" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-primary" />
              </span>
              Importing {importRun.records_imported} records
            </span>
          ) : null}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm" variant="outline" disabled={exportLoading}>
                {exportLoading ? (
                  <LoaderCircle className="mr-2 size-4 animate-spin" />
                ) : (
                  <Download className="mr-2 size-4" />
                )}
                Export
                <ChevronDown className="ml-1 size-3" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => void handleExport("csv")}>
                Export as CSV
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => void handleExport("xlsx")}>
                Export as XLSX
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => void handleExport("pdf")}>
                Export as PDF
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button size="sm" onClick={handleImport} disabled={isImporting}>
            {isImporting ? "Importing..." : "Import now"}
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader className="space-y-3">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <CardTitle className="text-base">Franchise list</CardTitle>
            <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
              <div className="flex items-center gap-2">
                <span>Sort by</span>
                <Select
                  value={sortOption}
                  onValueChange={(value) => {
                    setSortOption(
                      value as (typeof sortOptions)[number]["value"]
                    )
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
          <Input
            placeholder="Search by franchise or FID"
            value={search}
            onChange={handleSearchChange}
          />
          <div className="flex flex-col gap-3 md:flex-row md:items-center">
            <div className="md:w-48 md:flex-none">
              <Select
                value={statusFilter}
                onValueChange={(value) => {
                  setStatusFilter(
                    value as (typeof statusOptions)[number]["value"]
                  )
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
                value={selectedBranchFilterValue}
                onValueChange={(value) => {
                  if (value === "all") {
                    setSelectedBranchGroup("all")
                    setSelectedBranchId("all")
                  } else if (value.startsWith("group:")) {
                    setSelectedBranchGroup(value.slice("group:".length))
                    setSelectedBranchId("all")
                  } else if (value.startsWith("branch:")) {
                    setSelectedBranchId(value.slice("branch:".length))
                    setSelectedBranchGroup("all")
                  }
                  setPage(1)
                }}
              >
                <SelectTrigger>
                  <SelectValue
                    placeholder={
                      branchesLoading ? "Loading branches..." : "Filter by branch"
                    }
                  />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All branches</SelectItem>
                  {groupedBranches.length > 0 ? <SelectSeparator /> : null}
                  {groupedBranches.map((entry, index) => (
                    <React.Fragment key={entry.group}>
                      <SelectGroup>
                        <SelectLabel>{entry.group}</SelectLabel>
                        <SelectItem value={`group:${entry.group}`}>
                          All {entry.group}
                        </SelectItem>
                        {entry.branches.map((branch) => (
                          <SelectItem
                            key={branch.id}
                            value={`branch:${branch.id}`}
                          >
                            {branch.name}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                      {index < groupedBranches.length - 1 ? <SelectSeparator /> : null}
                    </React.Fragment>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button
              type="button"
              variant="outline"
              className="md:flex-none"
              onClick={() => {
                setSelectedBranchGroup("all")
                setSelectedBranchId("all")
                setPage(1)
              }}
            >
              Clear
            </Button>
          </div>
          {importRun?.status === "failed" && importRun.error_message ? (
            <p className="text-destructive text-xs">
              Last import failed: {importRun.error_message}
            </p>
          ) : null}
        </CardHeader>
        <CardContent className="space-y-4">
          {loading ? (
            <div className="text-muted-foreground text-sm">Loading merchants...</div>
          ) : null}
          {!loading && merchants.length === 0 ? (
            <div className="text-muted-foreground text-sm">
              No merchants found.
            </div>
          ) : null}
          {merchants.map((merchant, index) => (
            <div key={merchant.id} className="space-y-3">
              <Collapsible
                open={expandedId === merchant.id}
                onOpenChange={() => handleToggle(merchant.id, merchant.fid)}
              >
                <div className="flex flex-col gap-2 md:flex-row md:items-center">
                  <CollapsibleTrigger asChild>
                    <button
                      type="button"
                      className="hover:bg-muted/40 flex w-full flex-1 flex-col gap-2 rounded-lg px-2 py-2 text-left transition"
                    >
                      <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                        <div>
                          <div className="text-sm font-semibold">
                            {merchant.name}
                          </div>
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
                  {merchant.fid ? (
                    <Button asChild variant="outline" size="sm" className="md:self-center">
                      <Link href={`/merchants/${merchant.fid}`}>View merchant</Link>
                    </Button>
                  ) : (
                    <Button variant="outline" size="sm" className="md:self-center" disabled>
                      View merchant
                    </Button>
                  )}
                </div>
                <CollapsibleContent>
                  <div className="bg-muted/30 mt-2 space-y-4 rounded-lg border px-4 py-4 text-sm">
                    <div className="grid gap-3 md:grid-cols-2">
                      <div>
                        <div className="text-muted-foreground text-xs">
                          Company
                        </div>
                        <div className="font-medium">
                          {merchant.details.company ?? "—"}
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
                        <div className="text-muted-foreground text-xs">
                          Created at
                        </div>
                        <div className="font-medium">
                          {merchant.created_at
                            ? formatDateTime(merchant.created_at)
                            : "—"}
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
                                <div className="font-medium">
                                  {outlet.name}
                                </div>
                              </div>
                              {(() => {
                                const statusLabel = getOutletStatusLabel(
                                  outlet.valid_until
                                )
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
                                    : "—"}
                                </span>
                              </div>
                              <div>
                                <span className="block text-[11px] uppercase tracking-wide">
                                  Created at
                                </span>
                                <span className="text-foreground">
                                  {outlet.created_at
                                    ? formatDateTime(outlet.created_at)
                                    : "—"}
                                </span>
                              </div>
                              {outlet.maps_url ? (
                                <div className="md:col-span-2">
                                  <span className="block text-[11px] uppercase tracking-wide">
                                    Maps
                                  </span>
                                  <ExternalLink
                                    href={outlet.maps_url}
                                  >
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

    </div>
  )
}
