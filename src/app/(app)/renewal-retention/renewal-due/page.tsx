"use client"

import * as React from "react"

import { formatDateTime } from "@/lib/dates"
import { getSessionUser } from "@/lib/session"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { ExternalLink } from "@/components/external-link"
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

type ExpiringOutlet = {
  external_id: string
  name: string
  address: string | null
  maps_url: string | null
  valid_until: string
  created_at: string | null
}

type FranchiseGroup = {
  id: string
  name: string
  fid: string | null
  company: string | null
  outlets: ExpiringOutlet[]
}

const perPageOptions = [10, 25, 50, 100] as const

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

function getRenewalStatusLabel() {
  return "Expiring Soon"
}

function getRenewalStatusClasses() {
  return "bg-amber-500/15 text-amber-700 dark:text-amber-300"
}

export default function RenewalDuePage() {
  const [franchises, setFranchises] = React.useState<FranchiseGroup[]>([])
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [page, setPage] = React.useState(1)
  const [perPage, setPerPage] = React.useState(25)
  const [totalCount, setTotalCount] = React.useState(0)

  React.useEffect(() => {
    const user = getSessionUser()
    if (!user?.id) {
      setLoading(false)
      return
    }

    const load = async () => {
      setLoading(true)
      try {
        const params = new URLSearchParams()
        params.set("page", String(page))
        params.set("per_page", String(perPage))
        const response = await fetch(
          `/api/renewals/expiring?${params.toString()}`,
          {
          }
        )
        if (!response.ok) {
          throw new Error("Unable to load renewal due outlets.")
        }
        const data = (await response.json()) as {
          franchises: FranchiseGroup[]
          total: number
        }
        setFranchises(data.franchises ?? [])
        setTotalCount(data.total ?? 0)
        setError(null)
      } catch (loadError) {
        console.error(loadError)
        setError("Unable to load renewal due outlets.")
      } finally {
        setLoading(false)
      }
    }

    void load()
  }, [page, perPage])

  React.useEffect(() => {
    setPage(1)
  }, [perPage])

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
          <h1 className="text-2xl font-semibold tracking-tight">Renewal Due</h1>
          <p className="text-muted-foreground text-sm">
            Outlets expiring within the next 30 days.
          </p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <CardTitle className="text-base">Expiring soon</CardTitle>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span>Records per page</span>
              <Select
                value={String(perPage)}
                onValueChange={(value) => setPerPage(Number(value))}
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
        </CardHeader>
        <CardContent className="space-y-4">
          {loading ? (
            <div className="text-muted-foreground text-sm">
              Loading renewal due outlets...
            </div>
          ) : null}
          {!loading && error ? (
            <div className="text-destructive text-sm">{error}</div>
          ) : null}
          {!loading && !error && franchises.length === 0 ? (
            <div className="text-muted-foreground text-sm">
              No outlets expiring soon.
            </div>
          ) : null}
          {franchises.map((franchise, index) => (
            <div key={franchise.id} className="space-y-4">
              <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                <div>
                  <div className="text-sm font-semibold">{franchise.name}</div>
                  <div className="text-muted-foreground text-xs">
                    {franchise.company ?? "Company pending"} ·{" "}
                    {franchise.fid ? (
                      <ExternalLink
                        href={`https://cloud.getslurp.com/batcave/franchise/${franchise.fid}`}
                      >
                        {franchise.fid}
                      </ExternalLink>
                    ) : (
                      "FID pending"
                    )}
                  </div>
                </div>
                <span className="text-muted-foreground text-xs">
                  {franchise.outlets.length} outlets
                </span>
              </div>

              <div className="space-y-3">
                {franchise.outlets.map((outlet) => (
                  <div
                    key={`${franchise.id}-${outlet.external_id}`}
                    className="rounded-md border px-3 py-3 text-sm"
                  >
                    <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                      <div className="font-medium">{outlet.name}</div>
                      {(() => {
                        const statusLabel = getRenewalStatusLabel()
                        return (
                          <span
                            className={[
                              "rounded-full px-2.5 py-1 text-xs font-medium",
                              getRenewalStatusClasses(),
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
                          {formatDateTime(outlet.valid_until)}
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
                ))}
              </div>
              {index < franchises.length - 1 ? <Separator /> : null}
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
