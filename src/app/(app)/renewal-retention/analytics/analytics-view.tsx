"use client"

import * as React from "react"

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

import { KpiTile, money, PageHeader, PillTabs } from "../ui"

type Analytics = {
  period: { key: string; label: string }
  periods: Array<{ key: string; label: string }>
  renewal: {
    due: number
    renewable: number
    renewed: number
    nonRenewed: number
    potentialMinor: number
    collectedMinor: number
    collectionRate: number | null
    retentionRate: number | null
    termMix: { annually: number; biAnnually: number }
    groupedShare: number | null
  }
  engagement: {
    invoicesRaised: number
    opened: number
    openRate: number | null
    neverOpened: number
    paidAfterOpen: number
    linkToPaymentRate: number | null
    medianHoursToFirstOpen: number | null
    sessionsStarted: number
  }
  pricing: {
    reductionsMinor: number
    increasesMinor: number
    assignmentOverrides: number
    cycleOverrides: number
    cycleOverrideMinor: number
  }
  operations: {
    actionsOpen: number
    actionsBlocking: number
    averageDaysOpen: number | null
    medianDaysToPay: number | null
    paidOffline: number
    paidOfflineMinor: number
    reconciledBySweep: number
  }
  months: Array<{ month: string; potentialMinor: number; collectedMinor: number }>
}

type TabKey = "renewal" | "engagement" | "pricing" | "operations"

const pct = (value: number | null) => (value === null ? "—" : `${value.toFixed(1)}%`)
const hours = (value: number | null) => {
  if (value === null) return "—"
  if (value < 48) return `${Math.floor(value)}h ${Math.round((value % 1) * 60)}m`
  return `${(value / 24).toFixed(1)} days`
}

/**
 * Renewal Analytics, to the design: six tiles, four tabs of metrics with
 * their definitions beside them, and potential against collected by month.
 * Every figure is computed one way in `metrics.ts`; nothing here is derived
 * a second time.
 */
export function AnalyticsView() {
  const [data, setData] = React.useState<Analytics | null>(null)
  const [period, setPeriod] = React.useState<string | null>(null)
  const [tab, setTab] = React.useState<TabKey>("renewal")
  const [error, setError] = React.useState<string | null>(null)

  React.useEffect(() => {
    let cancelled = false
    const query = period ? `?period=${encodeURIComponent(period)}` : ""
    fetch(`/api/renewals/analytics${query}`, { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error("Unable to load the analytics.")
        const payload = (await response.json()) as Analytics
        if (!cancelled) setData(payload)
      })
      .catch((loadError: unknown) => {
        if (!cancelled) setError(loadError instanceof Error ? loadError.message : "Unable to load the analytics.")
      })
    return () => {
      cancelled = true
    }
  }, [period])

  if (error) {
    return <p className="text-destructive text-sm">{error}</p>
  }
  if (!data) {
    return <p className="text-muted-foreground text-sm">Computing the figures…</p>
  }

  const { renewal, engagement, pricing, operations } = data

  const tabs: Record<TabKey, { title: string; description: string; metrics: Array<{ label: string; definition: string; value: string }> }> = {
    renewal: {
      title: "Renewal and revenue",
      description: "Cohort-based. A renewal falling outside the period cannot inflate the numerator.",
      metrics: [
        { label: "Subscriptions due", definition: "Outlets with an expiry in the period", value: String(renewal.due) },
        { label: "Renewable subscriptions", definition: "Less reseller-billed, billing hold, and unresolved Actions Required", value: String(renewal.renewable) },
        { label: "Renewed", definition: "Paid within the same cohort", value: String(renewal.renewed) },
        { label: "Non-renewed", definition: "Expired unpaid, grace window included", value: String(renewal.nonRenewed) },
        { label: "Potential revenue", definition: "Resolved price at the default term, summed over renewable outlets", value: money(renewal.potentialMinor) },
        { label: "Collected revenue", definition: "Total of paid invoices in the cohort", value: money(renewal.collectedMinor) },
        { label: "Term mix", definition: "1-year against 6-month selections on paid invoices", value: `${renewal.termMix.annually} / ${renewal.termMix.biAnnually}` },
        { label: "Grouped invoice share", definition: "Grouped invoices ÷ all live invoices", value: pct(renewal.groupedShare) },
      ],
    },
    engagement: {
      title: "Link engagement",
      description: "The renewal link open is the only engagement signal; message opens are not tracked. Dispatch counts join when messaging goes live.",
      metrics: [
        { label: "Invoices raised", definition: "Proformas live in the cohort", value: String(engagement.invoicesRaised) },
        { label: "Link open rate", definition: "Invoices with a recorded open ÷ invoices raised", value: pct(engagement.openRate) },
        { label: "Never opened", definition: "Raised with no merchant visit", value: String(engagement.neverOpened) },
        { label: "Payment initiated", definition: "Invoices with a CommercePay session", value: String(engagement.sessionsStarted) },
        { label: "Link-to-payment conversion", definition: "Invoices paid ÷ invoices with a recorded open", value: pct(engagement.linkToPaymentRate) },
        { label: "Median time to first open", definition: "First open less invoice creation", value: hours(engagement.medianHoursToFirstOpen) },
      ],
    },
    pricing: {
      title: "Overrides and price variance",
      description: "Reductions and increases are reported separately and never netted into one figure.",
      metrics: [
        { label: "Price reductions given", definition: "Negative adjustments on paid invoices", value: money(pricing.reductionsMinor) },
        { label: "Price increases applied", definition: "Positive adjustments on paid invoices", value: money(pricing.increasesMinor) },
        { label: "Assignment overrides", definition: "Active assignments with a price override, applying every cycle", value: String(pricing.assignmentOverrides) },
        { label: "Cycle override usage", definition: "One-off overrides on lines in the period; recurring use signals a stale assignment", value: `${pricing.cycleOverrides} · ${money(pricing.cycleOverrideMinor)}` },
      ],
    },
    operations: {
      title: "Queue and collection health",
      description: "Every entry is attributable to the rows that produced it.",
      metrics: [
        { label: "Actions Required open", definition: `${operations.actionsBlocking} blocking`, value: String(operations.actionsOpen) },
        { label: "Average days open", definition: "Across open entries", value: operations.averageDaysOpen === null ? "—" : operations.averageDaysOpen.toFixed(1) },
        { label: "Median days to pay", definition: "Payment confirmed less invoice creation", value: operations.medianDaysToPay === null ? "—" : operations.medianDaysToPay.toFixed(1) },
        { label: "Collection rate", definition: "Collected ÷ potential revenue", value: pct(renewal.collectionRate) },
        { label: "Paid offline", definition: "Bank transfers marked paid by staff", value: `${operations.paidOffline} · ${money(operations.paidOfflineMinor)}` },
        { label: "Reconciled by Query sweep", definition: "Paid without a callback arriving", value: String(operations.reconciledBySweep) },
      ],
    },
  }

  const maxBar = Math.max(1, ...data.months.map((month) => Math.max(month.potentialMinor, month.collectedMinor)))
  const active = tabs[tab]

  return (
    <div className="animate-in fade-in slide-in-from-bottom-2 flex flex-col gap-5">
      <PageHeader
        title="Renewal Analytics"
        description="Computed from subscription, invoice, payment and queue rows. Every figure has one definition, shown beside it."
      >
        <Select value={data.period.key} onValueChange={setPeriod}>
          <SelectTrigger className="h-9 w-[180px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {data.periods.map((entry) => (
              <SelectItem key={entry.key} value={entry.key}>
                {entry.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </PageHeader>

      <div className="grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(min(100%,200px),1fr))]">
        <KpiTile label="Renewable subscriptions" value={String(renewal.renewable)} meta={`${renewal.due} due, less ${renewal.due - renewal.renewable} excluded`} />
        <KpiTile label="Renewed" value={String(renewal.renewed)} meta={`${renewal.nonRenewed} non-renewed`} />
        <KpiTile label="Retention rate" value={pct(renewal.retentionRate)} meta={`Within ${data.period.label}`} metaTone={renewal.retentionRate !== null && renewal.retentionRate >= 80 ? "green" : "gray"} />
        <KpiTile label="Collected revenue" value={money(renewal.collectedMinor)} meta={`of ${money(renewal.potentialMinor)} potential`} />
        <KpiTile label="Collection rate" value={pct(renewal.collectionRate)} meta="Paid invoices ÷ potential" metaTone={renewal.collectionRate !== null && renewal.collectionRate >= 80 ? "green" : "gray"} />
        <KpiTile label="Link open rate" value={pct(engagement.openRate)} meta={`${engagement.neverOpened} never opened`} metaTone={engagement.neverOpened > 0 ? "amber" : "gray"} />
      </div>

      <PillTabs
        value={tab}
        onChange={setTab}
        tabs={[
          { key: "renewal", label: "Renewal" },
          { key: "engagement", label: "Engagement" },
          { key: "pricing", label: "Pricing" },
          { key: "operations", label: "Operations" },
        ]}
      />

      <div className="grid items-start gap-6 [grid-template-columns:repeat(auto-fit,minmax(min(100%,340px),1fr))]">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{active.title}</CardTitle>
            <CardDescription>{active.description}</CardDescription>
          </CardHeader>
          <CardContent>
            {active.metrics.map((metric) => (
              <div key={metric.label} className="flex items-baseline justify-between gap-4 border-b py-2.5">
                <span className="flex min-w-0 flex-col">
                  <span className="text-sm">{metric.label}</span>
                  <span className="text-muted-foreground text-xs text-pretty">{metric.definition}</span>
                </span>
                <span className="shrink-0 text-[0.9375rem] font-semibold tabular-nums">{metric.value}</span>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Collected against potential</CardTitle>
            <CardDescription>
              Potential is the sum of resolved prices for outlets expiring in the month; collected is the total of invoices paid in it.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex h-[180px] items-end gap-2 pb-2">
              {data.months.map((month) => (
                <div key={month.month} className="flex flex-1 flex-col items-center gap-1.5">
                  <div className="relative flex h-[150px] w-full items-end justify-center">
                    <div
                      className="bg-muted-foreground/20 absolute bottom-0 w-[70%] rounded-t-[3px]"
                      style={{ height: `${Math.round((month.potentialMinor / maxBar) * 100)}%` }}
                      title={`Potential ${money(month.potentialMinor)}`}
                    />
                    <div
                      className="bg-primary absolute bottom-0 w-[70%] rounded-t-[3px]"
                      style={{ height: `${Math.round((month.collectedMinor / maxBar) * 100)}%` }}
                      title={`Collected ${money(month.collectedMinor)}`}
                    />
                  </div>
                  <span className="text-muted-foreground text-[0.6875rem]">
                    {new Date(`${month.month}-01T00:00:00Z`).toLocaleString("en-GB", { month: "short", timeZone: "UTC" })}
                  </span>
                </div>
              ))}
            </div>
            <div className="text-muted-foreground flex flex-wrap gap-4 border-t pt-3 text-xs">
              <span className="inline-flex items-center gap-1.5">
                <span className="bg-primary size-2.5 rounded-[2px]" />
                Collected
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="bg-muted-foreground/20 size-2.5 rounded-[2px]" />
                Potential
              </span>
              <span className="ml-auto">Retention is computed inside a single cohort period, so it cannot exceed 100%.</span>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
