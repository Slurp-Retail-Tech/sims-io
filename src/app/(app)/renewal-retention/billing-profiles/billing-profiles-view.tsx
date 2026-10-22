"use client"

import * as React from "react"

import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { useToast } from "@/components/toast-provider"
import { registrationLine } from "@/lib/renewal/document-content"

import { ColumnHeadings, PageHeader, Pill, PillTabs, plural, shortDateTime } from "../ui"
import type { Tone } from "../ui"
import { ProfileDialog } from "./profile-dialog"
import type { Candidate, Profile } from "./profile-dialog"

type Row = {
  franchiseId: string
  companyName: string | null
  outletCount: number
  defaultDocument: "proforma" | "quotation"
  profile: Profile | null
  candidates: Candidate[]
}

type Summary = {
  contacts: number
  skipped: Array<{ row: number; reason: string }>
  matched: number
  refreshed: number
  needsReview: number
  unmatched: number
  keptManual: number
}

type Filter = "all" | "review" | "missing" | "matched"

const PAGE_SIZE = 100

/** Where a franchise stands, for the pill and the filter. */
function standing(row: Row): { filter: Exclude<Filter, "all">; label: string; tone: Tone } {
  if (row.profile) {
    switch (row.profile.matchStatus) {
      case "auto":
        return { filter: "matched", label: "Auto-matched", tone: "blue" }
      case "confirmed":
        return { filter: "matched", label: "Confirmed", tone: "green" }
      case "manual":
        return { filter: "matched", label: "Entered by hand", tone: "green" }
    }
  }
  return row.candidates.length > 0
    ? { filter: "review", label: `${plural(row.candidates.length, "candidate")}`, tone: "amber" }
    : { filter: "missing", label: "No profile", tone: "gray" }
}

/**
 * Billing Profiles: who each franchise's renewal documents are billed to.
 *
 * Importing the Bukku Contacts export matches contacts to franchises by name
 * or email. Exactly one fit is linked automatically; the rest wait here for a
 * person to pick, link or type in, because the wrong SSM on an invoice is
 * worse than none.
 */
export function BillingProfilesView({ canManage, initialSearch }: { canManage: boolean; initialSearch: string }) {
  const { showToast } = useToast()
  const [rows, setRows] = React.useState<Row[]>([])
  const [contactCount, setContactCount] = React.useState(0)
  const [lastImportedAt, setLastImportedAt] = React.useState<string | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [filter, setFilter] = React.useState<Filter>("all")
  const [search, setSearch] = React.useState(initialSearch)
  const [limit, setLimit] = React.useState(PAGE_SIZE)
  const [importing, setImporting] = React.useState(false)
  const [summary, setSummary] = React.useState<Summary | null>(null)
  const [editing, setEditing] = React.useState<Row | null>(null)
  const fileInput = React.useRef<HTMLInputElement>(null)

  const load = React.useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const response = await fetch("/api/renewals/billing-profiles", { cache: "no-store" })
      if (!response.ok) {
        throw new Error("Unable to load the billing profiles.")
      }
      const payload = (await response.json()) as { rows: Row[]; contactCount: number; lastImportedAt: string | null }
      setRows(payload.rows)
      setContactCount(payload.contactCount)
      setLastImportedAt(payload.lastImportedAt)
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Unable to load the billing profiles.")
    } finally {
      setLoading(false)
    }
  }, [])

  React.useEffect(() => {
    void load()
  }, [load])

  async function importFile(file: File) {
    setImporting(true)
    setSummary(null)
    try {
      const form = new FormData()
      form.append("file", file)
      const response = await fetch("/api/renewals/billing-profiles/import", { method: "POST", body: form })
      const payload = (await response.json().catch(() => ({}))) as { error?: string; summary?: Summary }
      if (!response.ok || !payload.summary) {
        showToast(payload.error ?? "Unable to import the contacts.", "error")
        return
      }
      setSummary(payload.summary)
      showToast(`${plural(payload.summary.contacts, "contact")} imported.`, "success")
      void load()
    } catch {
      showToast("Unable to reach the server. Try again.", "error")
    } finally {
      setImporting(false)
      if (fileInput.current) fileInput.current.value = ""
    }
  }

  const counts = React.useMemo(() => {
    const tally = { all: rows.length, review: 0, missing: 0, matched: 0 }
    for (const row of rows) tally[standing(row).filter] += 1
    return tally
  }, [rows])

  const visible = React.useMemo(() => {
    const term = search.trim().toLowerCase()
    return rows.filter((row) => {
      if (filter !== "all" && standing(row).filter !== filter) return false
      if (!term) return true
      return [row.franchiseId, row.companyName, row.profile?.legalName, row.profile?.registrationNo, row.profile?.bukkuContactCode]
        .some((value) => value?.toLowerCase().includes(term))
    })
  }, [rows, filter, search])

  const grid = "grid-cols-[minmax(0,1.3fr)_minmax(0,1.6fr)_minmax(0,1fr)_auto]"

  return (
    <div className="animate-in fade-in slide-in-from-bottom-2 flex flex-col gap-5">
      <PageHeader
        title="Billing Profiles"
        description="The registered company, SSM, TIN and address printed under Bill To on each franchise's renewal documents."
        meta={
          contactCount > 0
            ? `${plural(contactCount, "Bukku contact")} on file${lastImportedAt ? `, last imported ${shortDateTime(lastImportedAt)}` : ""}.`
            : "No Bukku contacts imported yet."
        }
      >
        {canManage ? (
          <>
            <input
              ref={fileInput}
              type="file"
              accept=".xlsx,.xls,.csv"
              className="hidden"
              onChange={(event) => {
                const file = event.target.files?.[0]
                if (file) void importFile(file)
              }}
            />
            <Button size="sm" disabled={importing} onClick={() => fileInput.current?.click()}>
              {importing ? "Importing…" : "Import Bukku contacts"}
            </Button>
          </>
        ) : null}
      </PageHeader>

      {summary ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Import result</CardTitle>
            <CardDescription>
              {plural(summary.contacts, "contact")} read. Profiles entered by hand are never overwritten by an import.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-6">
              <Stat label="Newly matched" value={summary.matched} />
              <Stat label="Refreshed" value={summary.refreshed} />
              <Stat label="Needs review" value={summary.needsReview} />
              <Stat label="No match" value={summary.unmatched} />
              <Stat label="Kept (manual)" value={summary.keptManual} />
            </div>
            {summary.skipped.length > 0 ? (
              <details className="mt-3 text-xs">
                <summary className="text-muted-foreground cursor-pointer">
                  {plural(summary.skipped.length, "row")} skipped
                </summary>
                <ul className="text-muted-foreground mt-1.5 grid gap-0.5">
                  {summary.skipped.slice(0, 50).map((entry) => (
                    <li key={entry.row}>
                      Row {entry.row}: {entry.reason}
                    </li>
                  ))}
                </ul>
              </details>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <PillTabs<Filter>
              size="sm"
              value={filter}
              onChange={(key) => {
                setFilter(key)
                setLimit(PAGE_SIZE)
              }}
              tabs={[
                { key: "all", label: `All ${counts.all}` },
                { key: "review", label: `Needs review ${counts.review}` },
                { key: "missing", label: `No profile ${counts.missing}` },
                { key: "matched", label: `Has profile ${counts.matched}` },
              ]}
            />
            <Input
              value={search}
              onChange={(event) => {
                setSearch(event.target.value)
                setLimit(PAGE_SIZE)
              }}
              placeholder="Search name, FID, SSM or contact code"
              className="h-8 w-full sm:w-72"
            />
          </div>

          {error ? <p className="text-destructive text-sm">{error}</p> : null}
          {loading ? <p className="text-muted-foreground py-6 text-center text-sm">Loading…</p> : null}
          {!loading && !error && visible.length === 0 ? (
            <p className="text-muted-foreground py-6 text-center text-sm">
              {rows.length === 0 ? "No franchises in the renewal book yet." : "Nothing matches this filter."}
            </p>
          ) : null}

          {!loading && visible.length > 0 ? (
            <div className="overflow-x-auto">
              <div className="min-w-[720px]">
                <ColumnHeadings grid={grid} columns={[{ label: "Franchise" }, { label: "Billed to" }, { label: "Status" }, { label: "" }]} />
                {visible.slice(0, limit).map((row) => {
                  const state = standing(row)
                  const registration = row.profile ? registrationLine(row.profile) : null
                  return (
                    <div key={row.franchiseId} className={`grid items-center gap-3 border-b px-2 py-2.5 text-sm ${grid}`}>
                      <div className="flex min-w-0 flex-col">
                        <span className="truncate font-medium">{row.companyName ?? `Franchise ${row.franchiseId}`}</span>
                        <span className="text-muted-foreground text-xs">
                          FID {row.franchiseId} · {plural(row.outletCount, "outlet")}
                          {row.defaultDocument === "quotation" ? " · issued quotations" : ""}
                        </span>
                      </div>
                      <div className="flex min-w-0 flex-col">
                        {row.profile ? (
                          <>
                            <span className="truncate">{row.profile.legalName ?? "—"}</span>
                            <span className="text-muted-foreground truncate text-xs">
                              {[registration, row.profile.tin ? `TIN ${row.profile.tin}` : null, row.profile.bukkuContactCode]
                                .filter(Boolean)
                                .join(" · ") || "No SSM or TIN on file"}
                            </span>
                          </>
                        ) : row.candidates.length > 0 ? (
                          <span className="text-muted-foreground truncate text-xs">
                            {row.candidates.map((candidate) => candidate.legalName).join(" / ")}
                          </span>
                        ) : (
                          <span className="text-muted-foreground text-xs">Prints the company name alone</span>
                        )}
                      </div>
                      <div>
                        <Pill tone={state.tone}>{state.label}</Pill>
                      </div>
                      <div className="flex justify-end">
                        {canManage ? (
                          <Button variant="ghost" size="sm" onClick={() => setEditing(row)}>
                            {row.profile ? "Edit" : row.candidates.length > 0 ? "Review" : "Add"}
                          </Button>
                        ) : null}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          ) : null}
          {visible.length > limit ? (
            <Button variant="outline" size="sm" className="self-center" onClick={() => setLimit((current) => current + PAGE_SIZE)}>
              Show {Math.min(PAGE_SIZE, visible.length - limit)} more of {visible.length - limit}
            </Button>
          ) : null}
        </CardContent>
      </Card>

      {editing ? (
        <ProfileDialog
          open
          onOpenChange={(open) => {
            if (!open) setEditing(null)
          }}
          franchiseId={editing.franchiseId}
          companyName={editing.companyName}
          profile={editing.profile}
          candidates={editing.candidates}
          defaultDocument={editing.defaultDocument}
          onDefaultDocumentChanged={(value) =>
            setRows((current) =>
              current.map((row) => (row.franchiseId === editing.franchiseId ? { ...row, defaultDocument: value } : row))
            )
          }
          onSaved={(message) => {
            showToast(message, "success")
            setEditing(null)
            void load()
          }}
        />
      ) : null}
    </div>
  )
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <div className="text-muted-foreground text-xs">{label}</div>
      <div className="text-xl font-semibold tabular-nums">{value}</div>
    </div>
  )
}
