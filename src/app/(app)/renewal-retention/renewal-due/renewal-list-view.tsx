"use client"

import * as React from "react"
import Link from "next/link"
import { ChevronRight, Download, Info } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { cn } from "@/lib/utils"

import { daysLabel, longDate, money, PageHeader, Pill, plural, TERM_LABEL, TONE_TEXT } from "../ui"
import type { Tone } from "../ui"

type ListOutlet = {
  outletId: string
  outletName: string | null
  centralId: string | null
  validUntilDate: string | null
  billedBy: "slurp" | "reseller"
  billingHold: boolean
  planName: string | null
  resolvedFrom: string
  priceMinor: number | null
  state: string
  blockingReasons: string[]
  invoice: { id: string; number: string; status: string; openCount: number; term: string | null } | null
}

type ListFranchise = {
  franchiseId: string
  name: string | null
  fid: string | null
  grouped: boolean
  reseller: boolean
  validUntilDate: string | null
  daysToExpiry: number | null
  state: string
  stateLabel: string
  pic: string
  channels: string
  planSummary: string
  totalMinor: number | null
  note: string | null
  noteTone: "info" | "warn" | "block" | "muted" | null
  outlets: ListOutlet[]
}

const STATE_TONE: Record<string, Tone> = {
  renewed: "green",
  reminder_sent: "blue",
  invoiced: "blue",
  awaiting_payment: "amber",
  non_renewed: "red",
  action_required: "red",
  not_due: "gray",
  on_hold: "gray",
  reseller: "gray",
}

const STATE_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "all", label: "All renewal states" },
  { value: "not_due", label: "Not due" },
  { value: "invoiced", label: "Invoice raised" },
  { value: "reminder_sent", label: "Reminder sent" },
  { value: "awaiting_payment", label: "Awaiting payment" },
  { value: "renewed", label: "Renewed" },
  { value: "non_renewed", label: "Non-renewed" },
  { value: "action_required", label: "Action required" },
  { value: "on_hold", label: "On hold" },
  { value: "reseller", label: "Reseller-billed" },
]

const NOTE_CLASSES: Record<string, string> = {
  info: "bg-sky-500/8 text-sky-800 dark:text-sky-200",
  warn: "bg-amber-500/10 text-amber-900 dark:text-amber-100",
  block: "bg-red-500/8 text-red-800 dark:text-red-200",
  muted: "bg-muted/40 text-muted-foreground",
}

const OUTLET_GRID = "grid-cols-[minmax(0,1fr)_minmax(0,1fr)_7rem_8.5rem]"

function monthLabel(month: string): string {
  const [year, mm] = month.split("-")
  const names = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"]
  return `${names[Number(mm) - 1] ?? mm} ${year}`
}

/**
 * The Renewal List, to the design: one card per franchise with its state,
 * expiry, PIC, plan summary and total, expanding to a row per outlet with the
 * resolved plan and price, the invoice, and whether the link was opened.
 *
 * Filters run in the browser. The list is a bounded working view, so a
 * search that round-tripped would only add latency.
 */
export function RenewalListView({ actionCount }: { actionCount: number }) {
  const [franchises, setFranchises] = React.useState<ListFranchise[]>([])
  const [months, setMonths] = React.useState<string[]>([])
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  // Filters can arrive in the URL: `?fid=` from a Fix link, `?month=`,
  // `?state=` and `?opened=` from an Analytics figure.
  const [initial] = React.useState(() => {
    const params = typeof window === "undefined" ? new URLSearchParams() : new URLSearchParams(window.location.search)
    const periodKey = params.get("month")?.trim() ?? ""
    const stateParam = params.get("state") ?? ""
    const openedParam = params.get("opened") ?? ""
    return {
      fid: params.get("fid")?.trim() ?? "",
      periodKey: /^\d{4}(-\d{2})?$/.test(periodKey) ? periodKey : "",
      state: STATE_OPTIONS.some((option) => option.value === stateParam) ? stateParam : "all",
      opened: ["opened", "never"].includes(openedParam) ? openedParam : "all",
    }
  })
  const [search, setSearch] = React.useState(initial.fid)
  const [state, setState] = React.useState(initial.state)
  const [month, setMonth] = React.useState("all")
  const [opened, setOpened] = React.useState(initial.opened)
  const [period, setPeriod] = React.useState<{ key: string; label: string } | null>(null)
  const listQuery = initial.periodKey ? `month=${encodeURIComponent(initial.periodKey)}` : "horizon=90"
  const [expanded, setExpanded] = React.useState<Record<string, boolean>>({})

  const load = React.useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const response = await fetch(`/api/renewals/list?${listQuery}`, { cache: "no-store" })
      if (!response.ok) {
        throw new Error("Unable to load the renewal list.")
      }
      const payload = (await response.json()) as {
        franchises: ListFranchise[]
        months: string[]
        period: { key: string; label: string } | null
      }
      setFranchises(payload.franchises ?? [])
      setMonths(payload.months ?? [])
      setPeriod(payload.period ?? null)
      // Open the most urgent card by default, as the design does.
      const first = payload.franchises?.[0]
      if (first) {
        setExpanded((current) => (Object.keys(current).length ? current : { [first.franchiseId]: true }))
      }
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Unable to load the renewal list.")
    } finally {
      setLoading(false)
    }
  }, [listQuery])

  React.useEffect(() => {
    void load()
  }, [load])

  const visible = React.useMemo(() => {
    const query = search.trim().toLowerCase()
    return franchises.filter((franchise) => {
      if (query) {
        const haystack = [franchise.name ?? "", franchise.franchiseId, franchise.fid ?? "", ...franchise.outlets.map((outlet) => `${outlet.outletName ?? ""} ${outlet.outletId}`)]
          .join(" ")
          .toLowerCase()
        if (!haystack.includes(query)) return false
      }
      // A franchise carries its most urgent outlet's state, so a drill-through
      // to "Renewed" must also find the franchise with one renewed outlet
      // beside one that is still open.
      if (state !== "all" && franchise.state !== state && !franchise.outlets.some((outlet) => outlet.state === state)) return false
      if (month !== "all" && !(franchise.validUntilDate ?? "").startsWith(month)) return false
      if (opened === "opened" && !franchise.outlets.some((outlet) => (outlet.invoice?.openCount ?? 0) > 0)) return false
      if (opened === "never" && !franchise.outlets.some((outlet) => outlet.invoice && outlet.invoice.openCount === 0)) return false
      return true
    })
  }, [franchises, search, state, month, opened])

  const outletTotal = visible.reduce((sum, franchise) => sum + franchise.outlets.length, 0)

  return (
    <div className="animate-in fade-in slide-in-from-bottom-2 flex flex-col gap-5">
      <PageHeader
        title="Renewal List"
        description={
          period
            ? `Every subscription expiring in ${period.label}, grouped by franchise. State, resolved plan and price, renewal PIC, invoice, and engagement.`
            : "Every subscription due in the next 90 days, grouped by franchise. State, resolved plan and price, renewal PIC, invoice, and engagement."
        }
        meta={
          period ? (
            <Link href="/renewal-retention/renewal-due" className="underline underline-offset-2">
              Back to the next 90 days
            </Link>
          ) : undefined
        }
      >
        <Button variant="outline" size="sm" asChild>
          <a href={`/api/renewals/list?${listQuery}&format=csv`}>
            <Download className="size-4" />
            Export CSV
          </a>
        </Button>
        <Button variant="outline" size="sm" asChild>
          <Link href="/renewal-retention/actions-required">Actions Required · {actionCount}</Link>
        </Button>
      </PageHeader>

      <Card>
        <CardContent className="pt-6">
          <div className="flex flex-wrap items-center gap-3">
            <Input
              placeholder="Search franchise, outlet, or FID"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              className="h-9 w-[260px]"
            />
            <Select value={state} onValueChange={setState}>
              <SelectTrigger className="h-9 w-[190px]">
                <SelectValue placeholder="All renewal states" />
              </SelectTrigger>
              <SelectContent>
                {STATE_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={month} onValueChange={setMonth}>
              <SelectTrigger className="h-9 w-[170px]">
                <SelectValue placeholder="Expiry month" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All expiry months</SelectItem>
                {months.map((entry) => (
                  <SelectItem key={entry} value={entry}>
                    {monthLabel(entry)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={opened} onValueChange={setOpened}>
              <SelectTrigger className="h-9 w-[170px]">
                <SelectValue placeholder="Link opened" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Opened or not</SelectItem>
                <SelectItem value="opened">Link opened</SelectItem>
                <SelectItem value="never">Never opened</SelectItem>
              </SelectContent>
            </Select>
            <span className="text-muted-foreground ml-auto text-[0.8125rem]">
              {loading ? "Loading…" : `${plural(visible.length, "franchise")} · ${plural(outletTotal, "outlet")}`}
            </span>
          </div>
        </CardContent>
      </Card>

      {loading ? (
        <p className="text-muted-foreground text-sm">Loading the renewal list…</p>
      ) : error ? (
        <div>
          <p className="text-destructive text-sm">{error}</p>
          <Button size="sm" variant="outline" className="mt-3" onClick={() => void load()}>
            Try again
          </Button>
        </div>
      ) : visible.length === 0 ? (
        <Card>
          <CardContent className="text-muted-foreground py-10 text-sm">
            {franchises.length === 0
              ? period
                ? `No subscriptions expire in ${period.label}.`
                : "No subscriptions expire in the next 90 days."
              : "Nothing matches these filters."}
          </CardContent>
        </Card>
      ) : (
        <div className="flex flex-col gap-3.5">
          {visible.map((franchise) => {
            const isOpen = Boolean(expanded[franchise.franchiseId])
            const days = daysLabel(franchise.daysToExpiry)
            return (
              <div key={franchise.franchiseId} className="bg-card overflow-hidden rounded-[calc(var(--radius)+4px)] border">
                <button
                  type="button"
                  onClick={() => setExpanded((current) => ({ ...current, [franchise.franchiseId]: !isOpen }))}
                  className="flex w-full flex-wrap items-center gap-4 px-5 py-4 text-left"
                >
                  <ChevronRight className={cn("text-muted-foreground size-4 shrink-0 transition-transform", isOpen && "rotate-90")} />
                  <span className="flex min-w-0 flex-1 basis-[15rem] flex-col gap-0.5">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="text-[0.9375rem] font-semibold">{franchise.name ?? `Franchise ${franchise.franchiseId}`}</span>
                      <span className="text-muted-foreground text-xs">FID {franchise.fid ?? franchise.franchiseId}</span>
                      {franchise.reseller ? (
                        <span className="text-muted-foreground rounded-full border px-2 py-px text-[11px]">Reseller-billed</span>
                      ) : null}
                      {franchise.grouped ? (
                        <Pill tone="blue" className="font-medium">
                          Grouped invoice
                        </Pill>
                      ) : null}
                    </span>
                    <span className="text-muted-foreground text-xs">
                      {plural(franchise.outlets.length, "outlet")} · {franchise.planSummary}
                    </span>
                  </span>
                  <span className="flex min-w-[8.5rem] shrink-0 flex-col gap-0.5">
                    <span className="text-[0.8125rem]">{longDate(franchise.validUntilDate)}</span>
                    <span className={cn("text-xs", TONE_TEXT[days.tone])}>{days.label}</span>
                  </span>
                  <span className="flex min-w-[9rem] shrink-0 flex-col gap-0.5">
                    <span className="text-[0.8125rem]">{franchise.pic}</span>
                    <span className="text-muted-foreground text-xs">{franchise.channels}</span>
                  </span>
                  <span className="min-w-[7rem] shrink-0 text-right text-[0.9375rem] font-semibold tabular-nums">
                    {franchise.totalMinor === null ? "—" : money(franchise.totalMinor)}
                  </span>
                  <Pill tone={STATE_TONE[franchise.state] ?? "gray"} className="shrink-0 px-2.5 py-[0.1875rem]">
                    {franchise.stateLabel}
                  </Pill>
                </button>

                {isOpen ? (
                  <div className="border-t">
                    {franchise.note ? (
                      <div className={cn("flex items-start gap-2 border-b px-5 py-2.5 text-[0.8125rem]", NOTE_CLASSES[franchise.noteTone ?? "muted"])}>
                        <Info className="mt-0.5 size-3.5 shrink-0" />
                        <span>{franchise.note}</span>
                      </div>
                    ) : null}
                    <div className={cn("text-muted-foreground grid gap-3 border-b px-5 py-2 text-[11px] tracking-[0.05em] uppercase", OUTLET_GRID)}>
                      <span>Outlet</span>
                      <span>Plan · resolved from</span>
                      <span className="text-right">Price</span>
                      <span>Invoice</span>
                    </div>
                    {franchise.outlets.map((outlet) => (
                      <div key={outlet.outletId} className={cn("grid items-center gap-3 border-b px-5 py-2.5 text-[0.8125rem]", OUTLET_GRID)}>
                        <span className="flex min-w-0 flex-col">
                          <span>{outlet.outletName ?? `Outlet ${outlet.outletId}`}</span>
                          <span className="text-muted-foreground text-xs">
                            OID {outlet.outletId}
                            {outlet.centralId ? ` · ${outlet.centralId}` : ""} · expires {longDate(outlet.validUntilDate)}
                          </span>
                        </span>
                        <span className="flex min-w-0 flex-col">
                          <span>{outlet.planName ?? "—"}</span>
                          <span className="text-muted-foreground text-xs">
                            {outlet.blockingReasons.length > 0 ? outlet.blockingReasons.join(", ") : outlet.resolvedFrom}
                          </span>
                        </span>
                        <span className="text-right whitespace-nowrap tabular-nums">
                          {outlet.priceMinor === null || outlet.billedBy === "reseller" ? "—" : money(outlet.priceMinor)}
                        </span>
                        <span className="flex min-w-0 flex-col">
                          {outlet.invoice ? (
                            <>
                              <Link href={`/renewal-retention/invoices/${outlet.invoice.id}`} className="text-primary font-mono text-xs whitespace-nowrap hover:underline">
                                {outlet.invoice.number}
                              </Link>
                              <span className="text-muted-foreground text-xs">
                                {outlet.invoice.status.replace("_", " ")}
                                {outlet.invoice.term ? ` · ${TERM_LABEL[outlet.invoice.term]} term` : ""}
                              </span>
                              <span className={cn("text-xs", outlet.invoice.openCount === 0 ? TONE_TEXT.amber : "text-muted-foreground")}>
                                {outlet.invoice.openCount === 0 ? "Never opened" : `Opened ${outlet.invoice.openCount}×`}
                              </span>
                            </>
                          ) : (
                            <span className="text-muted-foreground text-xs">
                              {outlet.billedBy === "reseller" ? "Reseller-billed" : outlet.blockingReasons[0] ?? "—"}
                            </span>
                          )}
                        </span>
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
