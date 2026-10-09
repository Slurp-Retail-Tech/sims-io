"use client"

import * as React from "react"
import Link from "next/link"
import { Mail, Phone, Plus, X } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
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
import {
  formatMappingCount,
  summarizeMappings,
} from "@/lib/contact-mappings"
import { formatContactSource, formatExtraPhones } from "@/lib/contacts"
import { cn } from "@/lib/utils"

import { ContactDialog } from "./contact-dialog"
import { MappingBadge } from "./mapping-scope-badge"
import {
  readContactsFilterCookie,
  writeContactsFilterCookie,
} from "./filter-state"
import type { Contact, ContactFilterOptions, ContactMappingRow } from "./types"

const ALL_VALUE = "__all__"
const PER_PAGE_OPTIONS = [10, 25, 50, 100]

/** Column ratios come straight from the design's directory grid. */
const ROW_GRID = "grid-cols-[1.4fr_1.2fr_1.4fr_1fr_0.8fr]"

/**
 * Shared by every list page in this repo — a windowed page list with ellipses. Copied
 * rather than imported because each page owns its own copy today; extracting it is a
 * separate cleanup.
 */
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

export function ContactsView() {
  const [contacts, setContacts] = React.useState<Contact[]>([])
  const [total, setTotal] = React.useState(0)
  const [loading, setLoading] = React.useState(true)
  const [loadError, setLoadError] = React.useState<string | null>(null)

  const [searchInput, setSearchInput] = React.useState("")
  const [searchQuery, setSearchQuery] = React.useState("")

  // Read from the cookie in a lazy initialiser, not an effect, so the persisted filter
  // is applied on the very first render and the list does not flash unfiltered.
  // A `?fid=` in the URL (a deep link from Actions Required) wins over the
  // remembered filter for this visit only; the cookie is rewritten from it.
  const [filters, setFilters] = React.useState(() => {
    const remembered = readContactsFilterCookie()
    if (typeof window === "undefined") {
      return remembered
    }
    const fid = new URLSearchParams(window.location.search).get("fid")?.trim()
    return fid ? { franchiseId: fid, outletId: "", role: "" } : remembered
  })
  const [page, setPage] = React.useState(1)
  const [perPage, setPerPage] = React.useState(25)

  const [options, setOptions] = React.useState<ContactFilterOptions>({
    roles: [],
    franchises: [],
    outlets: [],
  })

  const [selectedId, setSelectedId] = React.useState<string | null>(null)
  const [selectedMappings, setSelectedMappings] = React.useState<ContactMappingRow[]>([])
  const [mappingsLoading, setMappingsLoading] = React.useState(false)
  const [createOpen, setCreateOpen] = React.useState(false)

  React.useEffect(() => {
    const handle = setTimeout(() => setSearchQuery(searchInput.trim()), 300)
    return () => clearTimeout(handle)
  }, [searchInput])

  React.useEffect(() => {
    setPage(1)
  }, [searchQuery, perPage, filters.franchiseId, filters.outletId, filters.role])

  React.useEffect(() => {
    writeContactsFilterCookie(filters)
  }, [filters])

  const loadContacts = React.useCallback(async () => {
    setLoading(true)
    setLoadError(null)
    try {
      const params = new URLSearchParams()
      params.set("page", String(page))
      params.set("per_page", String(perPage))
      if (searchQuery) params.set("q", searchQuery)
      if (filters.franchiseId) params.set("fid", filters.franchiseId)
      if (filters.outletId) params.set("oid", filters.outletId)
      if (filters.role) params.set("role", filters.role)

      const response = await fetch(`/api/contacts?${params.toString()}`)
      if (!response.ok) {
        throw new Error("Unable to load contacts.")
      }

      const payload = (await response.json()) as {
        contacts: Contact[]
        total: number
      }
      setContacts(payload.contacts ?? [])
      setTotal(payload.total ?? 0)
    } catch (error) {
      console.error(error)
      setContacts([])
      setTotal(0)
      setLoadError("Unable to load contacts.")
    } finally {
      setLoading(false)
    }
  }, [page, perPage, searchQuery, filters.franchiseId, filters.outletId, filters.role])

  React.useEffect(() => {
    void loadContacts()
  }, [loadContacts])

  React.useEffect(() => {
    let cancelled = false
    const load = async () => {
      try {
        const response = await fetch("/api/contacts/filter-options")
        if (!response.ok) {
          return
        }
        const payload = (await response.json()) as ContactFilterOptions
        if (!cancelled) {
          setOptions(payload)
        }
      } catch (error) {
        console.error(error)
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [])

  // The drawer shows the selected contact's mappings, which the list payload does not
  // carry (it only carries a count), so they load on selection.
  React.useEffect(() => {
    if (!selectedId) {
      setSelectedMappings([])
      return
    }

    let cancelled = false
    setMappingsLoading(true)
    const load = async () => {
      try {
        const response = await fetch(`/api/contacts/${selectedId}/mappings`)
        if (!response.ok) {
          throw new Error("Unable to load mappings.")
        }
        const payload = (await response.json()) as { mappings: ContactMappingRow[] }
        if (!cancelled) {
          setSelectedMappings(payload.mappings ?? [])
        }
      } catch (error) {
        console.error(error)
        if (!cancelled) {
          setSelectedMappings([])
        }
      } finally {
        if (!cancelled) {
          setMappingsLoading(false)
        }
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [selectedId])

  const selected = contacts.find((contact) => contact.id === selectedId) ?? null
  const totalPages = Math.max(1, Math.ceil(total / perPage))

  // Outlet options are scoped to the chosen franchise: offering outlets from other
  // franchises would produce a filter combination with no rows.
  const outletOptions = filters.franchiseId
    ? options.outlets.filter((outlet) => outlet.franchiseId === filters.franchiseId)
    : options.outlets

  return (
    <div className="animate-in fade-in slide-in-from-bottom-2 flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Contacts</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            Merchant-side people, mapped to the outlets and franchises they represent.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <span className="text-muted-foreground">
            {total} contact{total === 1 ? "" : "s"}
          </span>
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            <Plus />
            New contact
          </Button>
        </div>
      </div>

      <div className="flex items-start gap-6">
        <div className="min-w-0 flex-1">
          <Card>
            <CardHeader className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <CardTitle className="text-base">Contact directory</CardTitle>
                <div className="text-muted-foreground flex items-center gap-2 text-xs">
                  <span>Records per page</span>
                  <Select
                    value={String(perPage)}
                    onValueChange={(value) => setPerPage(Number(value))}
                  >
                    <SelectTrigger className="h-8 w-[84px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {PER_PAGE_OPTIONS.map((option) => (
                        <SelectItem key={option} value={String(option)}>
                          {option}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <Input
                placeholder="Search by name, phone, or email"
                value={searchInput}
                onChange={(event) => setSearchInput(event.target.value)}
              />

              <div className="flex flex-wrap gap-3">
                <Select
                  value={filters.franchiseId || ALL_VALUE}
                  onValueChange={(value) =>
                    setFilters((current) => ({
                      ...current,
                      franchiseId: value === ALL_VALUE ? "" : value,
                      // A franchise change can invalidate the outlet selection.
                      outletId: "",
                    }))
                  }
                >
                  <SelectTrigger className="h-9 w-[220px]">
                    <SelectValue placeholder="All franchises" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ALL_VALUE}>All franchises</SelectItem>
                    {options.franchises.map((franchise) => (
                      <SelectItem key={franchise.id} value={franchise.id}>
                        {franchise.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                <Select
                  value={filters.outletId || ALL_VALUE}
                  onValueChange={(value) =>
                    setFilters((current) => ({
                      ...current,
                      outletId: value === ALL_VALUE ? "" : value,
                    }))
                  }
                >
                  <SelectTrigger className="h-9 w-[220px]">
                    <SelectValue placeholder="All outlets" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ALL_VALUE}>All outlets</SelectItem>
                    {outletOptions.map((outlet) => (
                      <SelectItem key={`${outlet.franchiseId}-${outlet.id}`} value={outlet.id}>
                        {outlet.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                <Select
                  value={filters.role || ALL_VALUE}
                  onValueChange={(value) =>
                    setFilters((current) => ({
                      ...current,
                      role: value === ALL_VALUE ? "" : value,
                    }))
                  }
                >
                  <SelectTrigger className="h-9 w-[180px]">
                    <SelectValue placeholder="All roles" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ALL_VALUE}>All roles</SelectItem>
                    {options.roles.map((role) => (
                      <SelectItem key={role} value={role}>
                        {role}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </CardHeader>

            <CardContent>
              <div
                className={cn(
                  "text-muted-foreground grid gap-3 border-b px-2 pb-2.5 text-[11px] tracking-wider uppercase",
                  ROW_GRID
                )}
              >
                <span>Name</span>
                <span>Phone</span>
                <span>Email</span>
                <span>Role</span>
                <span className="text-right">Mappings</span>
              </div>

              {loading ? (
                <div className="text-muted-foreground py-6 text-sm">
                  Loading contacts...
                </div>
              ) : loadError ? (
                <div className="text-destructive flex items-center gap-3 py-6 text-sm">
                  <span>{loadError}</span>
                  <Button variant="outline" size="sm" onClick={() => void loadContacts()}>
                    Retry
                  </Button>
                </div>
              ) : contacts.length ? (
                <>
                  {contacts.map((contact) => (
                    <button
                      key={contact.id}
                      type="button"
                      onClick={() =>
                        setSelectedId((current) =>
                          current === contact.id ? null : contact.id
                        )
                      }
                      className={cn(
                        "hover:bg-accent/40 grid w-full items-center gap-3 border-b px-2 py-3 text-left text-sm",
                        ROW_GRID,
                        contact.id === selectedId && "bg-accent/60"
                      )}
                    >
                      <span className="flex min-w-0 flex-col gap-0.5">
                        <span className="truncate font-medium">{contact.name}</span>
                        <span className="text-muted-foreground text-xs">
                          {formatContactSource(contact.source)}
                        </span>
                      </span>
                      <span className="flex flex-col gap-0.5 text-[13px]">
                        <span>{contact.phones[0]?.phone ?? "--"}</span>
                        <span className="text-muted-foreground text-xs">
                          {formatExtraPhones(contact.phones)}
                        </span>
                      </span>
                      <span className="text-muted-foreground truncate text-[13px]">
                        {contact.email}
                      </span>
                      <span className="truncate text-[13px]">{contact.role ?? "--"}</span>
                      <span className="text-muted-foreground text-right text-[13px]">
                        {formatMappingCount(contact.mappingCount)}
                      </span>
                    </button>
                  ))}

                  <Separator className="my-4" />

                  <div className="grid gap-3 md:grid-cols-[1fr_auto_1fr] md:items-center">
                    <div className="text-muted-foreground text-xs">
                      Page {page} of {totalPages} · {total} record
                      {total === 1 ? "" : "s"}
                    </div>
                    {totalPages > 1 ? (
                      <Pagination>
                        <PaginationContent>
                          <PaginationItem>
                            <PaginationPrevious
                              href="#"
                              aria-disabled={page === 1}
                              className={cn(
                                page === 1 && "pointer-events-none opacity-50"
                              )}
                              onClick={(event) => {
                                event.preventDefault()
                                setPage((current) => Math.max(1, current - 1))
                              }}
                            />
                          </PaginationItem>
                          {getPaginationItems(page, totalPages).map((item, index) =>
                            item === "ellipsis" ? (
                              <PaginationItem key={`ellipsis-${index}`}>
                                <PaginationEllipsis />
                              </PaginationItem>
                            ) : (
                              <PaginationItem key={item}>
                                <PaginationLink
                                  href="#"
                                  isActive={item === page}
                                  onClick={(event) => {
                                    event.preventDefault()
                                    setPage(Number(item))
                                  }}
                                >
                                  {item}
                                </PaginationLink>
                              </PaginationItem>
                            )
                          )}
                          <PaginationItem>
                            <PaginationNext
                              href="#"
                              aria-disabled={page === totalPages}
                              className={cn(
                                page === totalPages && "pointer-events-none opacity-50"
                              )}
                              onClick={(event) => {
                                event.preventDefault()
                                setPage((current) => Math.min(totalPages, current + 1))
                              }}
                            />
                          </PaginationItem>
                        </PaginationContent>
                      </Pagination>
                    ) : (
                      <div />
                    )}
                    <div className="text-muted-foreground text-right text-xs">
                      Soft-deleted contacts are excluded.
                    </div>
                  </div>
                </>
              ) : (
                <div className="text-muted-foreground py-6 text-sm">
                  No contacts match the selected filters.
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {selected ? (
          <aside className="bg-card sticky top-[5.5rem] hidden w-[22rem] flex-none rounded-xl border shadow-sm lg:block">
            <div className="flex items-start justify-between gap-3 border-b px-5 py-4">
              <div>
                <div className="font-semibold">{selected.name}</div>
                <div className="text-muted-foreground text-xs">
                  {selected.role ?? "No role recorded"}
                </div>
              </div>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Close preview"
                onClick={() => setSelectedId(null)}
              >
                <X />
              </Button>
            </div>

            <div className="flex flex-col gap-3 p-5 text-sm">
              <div className="text-muted-foreground flex items-center gap-2">
                <Phone className="size-3.5" />
                <span className="text-foreground">
                  {selected.phones.map((phone) => phone.phone).join(" · ") || "--"}
                </span>
              </div>
              <div className="text-muted-foreground flex items-center gap-2">
                <Mail className="size-3.5" />
                <span className="text-foreground truncate">{selected.email}</span>
              </div>

              <Separator />

              <div className="text-muted-foreground text-[11px] tracking-wider uppercase">
                Mapped to
              </div>

              {mappingsLoading ? (
                <div className="text-muted-foreground text-sm">Loading mappings...</div>
              ) : selectedMappings.length ? (
                <>
                  {selectedMappings.map((mapping) => (
                    <div
                      key={mapping.id}
                      className="flex items-center justify-between gap-2 rounded-md border px-3 py-2"
                    >
                      <span className="flex min-w-0 flex-col">
                        <span className="truncate text-[13px] font-medium">
                          {mapping.outletId === null
                            ? mapping.franchiseName ?? `FID ${mapping.franchiseId}`
                            : mapping.outletName ?? `Outlet ${mapping.outletId}`}
                        </span>
                        <span className="text-muted-foreground truncate text-xs">
                          {mapping.outletId === null
                            ? `FID ${mapping.franchiseId}`
                            : `${mapping.franchiseName ?? mapping.franchiseId} · OID ${mapping.outletId}`}
                        </span>
                      </span>
                      <MappingBadge franchiseWide={mapping.outletId === null} />
                    </div>
                  ))}
                  <div className="text-muted-foreground text-xs">
                    {summarizeMappings(selectedMappings)}
                  </div>
                </>
              ) : (
                <div className="text-muted-foreground text-sm">No mappings yet.</div>
              )}

              <Button variant="outline" size="sm" className="mt-2" asChild>
                <Link href={`/contacts/${selected.id}`}>Open contact page</Link>
              </Button>
            </div>
          </aside>
        ) : null}
      </div>

      <ContactDialog
        open={createOpen}
        contact={null}
        onClose={() => setCreateOpen(false)}
        onSaved={() => {
          setCreateOpen(false)
          void loadContacts()
        }}
      />
    </div>
  )
}
