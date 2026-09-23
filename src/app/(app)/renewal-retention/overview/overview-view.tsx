"use client"

import * as React from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { CheckCircle2, Circle, Clock } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { cn } from "@/lib/utils"

import { daysLabel, KpiTile, longDate, money, PageHeader, Pill, plural, shortDateTime, TONE_DOT, TONE_TEXT } from "../ui"
import type { Tone } from "../ui"

type Franchise = {
  franchiseId: string
  name: string | null
  fid: string | null
  validUntilDate: string | null
  daysToExpiry: number | null
  state: string
  stateLabel: string
  pic: string
  totalMinor: number | null
  outlets: Array<{ outletId: string }>
}

type SetupStep = {
  key: string
  title: string
  state: "done" | "todo" | "not_checked"
  detail: string
  href: string
  cta: string
}

type Setup = { steps: SetupStep[]; doneCount: number; complete: boolean }

type Overview = {
  setup?: Setup
  today: string
  lastRun: { finishedAt: string | null; status: string | null } | null
  kpis: {
    expiringIn30: { count: number; potentialMinor: number }
    collectedThisMonth: { amountMinor: number; potentialMinor: number; invoices: number }
    retention: { renewed: number; renewable: number }
    actions: { open: number; blocking: number }
  }
  expiringSoon: Franchise[]
  funnel: { invoicesRaised: number; linkOpened: number; sessionsStarted: number; paid: number; paidMinor: number }
  actionSummary: Array<{ reason: string; count: number; blocking: boolean }>
  recentPayments: Array<{
    invoiceId: string
    invoiceNumber: string
    companyName: string | null
    outlets: number
    paidAt: string | null
    totalMinor: number
    extensionStatus: string
  }>
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

function pct(numerator: number, denominator: number): string {
  if (denominator === 0) {
    return "—"
  }
  return `${((numerator / denominator) * 100).toFixed(1)}%`
}

/**
 * The overview, to the design, on live rows.
 *
 * Four tiles that each open the screen behind the number, the outlets
 * expiring next, the funnel from invoice to payment, the blocked summary and
 * recent payments. The funnel starts at "invoices raised" rather than
 * "reminders dispatched" because dispatch is not built yet, and a stage with
 * no data source is worse left out than shown as zero.
 */
export function OverviewView() {
  const router = useRouter()
  const [data, setData] = React.useState<Overview | null>(null)
  const [error, setError] = React.useState<string | null>(null)

  React.useEffect(() => {
    let cancelled = false
    fetch("/api/renewals/overview", { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error("Unable to load the overview.")
        const payload = (await response.json()) as Overview
        if (!cancelled) setData(payload)
      })
      .catch((loadError: unknown) => {
        if (!cancelled) setError(loadError instanceof Error ? loadError.message : "Unable to load the overview.")
      })
    return () => {
      cancelled = true
    }
  }, [])

  if (error) {
    return <p className="text-destructive text-sm">{error}</p>
  }
  if (!data) {
    return <p className="text-muted-foreground text-sm">Loading the renewal book…</p>
  }

  const { kpis, funnel } = data
  const monthName = new Date(`${data.today}T00:00:00Z`).toLocaleString("en-GB", { month: "long", timeZone: "UTC" })
  const stages = [
    { label: "Invoices raised", value: funnel.invoicesRaised, meta: "Proformas live for a reminder date", tone: "gray" as Tone },
    { label: "Renewal link opened", value: funnel.linkOpened, meta: `${pct(funnel.linkOpened, funnel.invoicesRaised)} of invoices raised`, tone: "blue" as Tone },
    { label: "Payment initiated", value: funnel.sessionsStarted, meta: "Sessions created at CommercePay", tone: "amber" as Tone },
    { label: "Paid", value: funnel.paid, meta: `${money(funnel.paidMinor)} collected`, tone: "green" as Tone },
  ]
  const max = Math.max(1, funnel.invoicesRaised)

  return (
    <div className="animate-in fade-in slide-in-from-bottom-2 flex flex-col gap-5">
      <PageHeader
        title="Renewal & Retention"
        description="Where the renewal book stands today: what is due, what has been collected, and what is blocked."
      >
        <span className="text-muted-foreground text-[0.8125rem]">
          {data.lastRun
            ? `Nightly run ${data.lastRun.status} ${shortDateTime(data.lastRun.finishedAt)}`
            : "The nightly run has not happened yet"}
        </span>
      </PageHeader>

      {data.setup && !data.setup.complete ? <SetupChecklistCard setup={data.setup} /> : null}

      <div className="grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(min(100%,210px),1fr))]">
        <KpiTile
          label="Expiring in 30 days"
          value={String(kpis.expiringIn30.count)}
          meta={`${money(kpis.expiringIn30.potentialMinor)} at the default term`}
          onClick={() => router.push("/renewal-retention/renewal-due")}
        />
        <KpiTile
          label={`Collected in ${monthName}`}
          value={money(kpis.collectedThisMonth.amountMinor)}
          meta={`${pct(kpis.collectedThisMonth.amountMinor, kpis.collectedThisMonth.potentialMinor)} of ${money(kpis.collectedThisMonth.potentialMinor)} potential`}
          metaTone={kpis.collectedThisMonth.amountMinor > 0 ? "green" : "gray"}
          onClick={() => router.push("/renewal-retention/invoices?status=paid")}
        />
        <KpiTile
          label={`Retention · ${monthName} cohort`}
          value={pct(kpis.retention.renewed, kpis.retention.renewable)}
          meta={`${kpis.retention.renewed} renewed of ${kpis.retention.renewable} renewable`}
          onClick={() => router.push("/renewal-retention/analytics")}
        />
        <KpiTile
          label="Actions Required"
          value={String(kpis.actions.open)}
          meta={kpis.actions.blocking > 0 ? `${kpis.actions.blocking} block an invoice being raised` : "Nothing is blocked"}
          metaTone={kpis.actions.blocking > 0 ? "red" : "green"}
          onClick={() => router.push("/renewal-retention/actions-required")}
        />
      </div>

      <div className="grid items-start gap-6 [grid-template-columns:repeat(auto-fit,minmax(min(100%,340px),1fr))]">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Expiring next</CardTitle>
            <CardDescription>Sorted by urgency. Amounts are the resolved price at the default term.</CardDescription>
            <CardAction>
              <Button variant="outline" size="sm" asChild>
                <Link href="/renewal-retention/renewal-due">Renewal List</Link>
              </Button>
            </CardAction>
          </CardHeader>
          <CardContent>
            {data.expiringSoon.length === 0 ? (
              <p className="text-muted-foreground py-4 text-sm">Nothing expires in the next 30 days.</p>
            ) : null}
            {data.expiringSoon.map((franchise) => {
              const days = daysLabel(franchise.daysToExpiry)
              return (
                <Link
                  key={franchise.franchiseId}
                  href={`/renewal-retention/renewal-due?fid=${encodeURIComponent(franchise.franchiseId)}`}
                  className="hover:bg-accent/40 grid w-full grid-cols-[minmax(0,1fr)_7rem_8rem] items-center gap-3 border-b py-2.5 text-left"
                >
                  <span className="flex min-w-0 flex-col gap-0.5">
                    <span className="text-sm">{franchise.name ?? `Franchise ${franchise.franchiseId}`}</span>
                    <span className="text-muted-foreground text-xs">
                      {plural(franchise.outlets.length, "outlet")} · {longDate(franchise.validUntilDate)} · {franchise.pic}
                    </span>
                  </span>
                  <span className="text-right text-[0.8125rem] whitespace-nowrap tabular-nums">
                    {franchise.totalMinor === null ? "—" : money(franchise.totalMinor)}
                  </span>
                  <span className="flex flex-col items-start gap-1">
                    <Pill tone={STATE_TONE[franchise.state] ?? "gray"}>{franchise.stateLabel}</Pill>
                    <span className={cn("text-xs", TONE_TEXT[days.tone])}>{days.label}</span>
                  </span>
                </Link>
              )
            })}
          </CardContent>
        </Card>

        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Invoice to payment</CardTitle>
              <CardDescription>Counted from invoice, link and payment session rows. Dispatch joins this funnel when messaging goes live.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex flex-col gap-3">
                {stages.map((stage) => (
                  <div key={stage.label} className="flex flex-col gap-1.5">
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="text-[0.8125rem]">{stage.label}</span>
                      <span className="text-[0.8125rem] font-semibold tabular-nums">{stage.value}</span>
                    </div>
                    <div className="bg-muted-foreground/15 h-1.5 rounded-full">
                      <div
                        className={cn("h-1.5 rounded-full", TONE_DOT[stage.tone])}
                        style={{ width: `${Math.round((stage.value / max) * 100)}%` }}
                      />
                    </div>
                    <span className="text-muted-foreground text-xs">{stage.meta}</span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Blocked before the reminder window</CardTitle>
              <CardDescription>
                {kpis.actions.blocking === 0
                  ? "Nothing stops an invoice being raised."
                  : `${plural(kpis.actions.blocking, "entry", "entries")} stop an invoice being raised at all.`}
              </CardDescription>
              <CardAction>
                <Button variant="outline" size="sm" asChild>
                  <Link href="/renewal-retention/actions-required">Work the queue</Link>
                </Button>
              </CardAction>
            </CardHeader>
            <CardContent>
              {data.actionSummary.length === 0 ? (
                <p className="text-muted-foreground py-2 text-sm">The queue is empty.</p>
              ) : null}
              {data.actionSummary.map((entry) => (
                <div key={entry.reason} className="flex items-center justify-between gap-3 border-b py-2">
                  <span className="flex min-w-0 items-center gap-2">
                    <span className={cn("size-1.5 rounded-full", entry.blocking ? TONE_DOT.red : TONE_DOT.gray)} />
                    <span className="font-mono text-xs">{entry.reason}</span>
                  </span>
                  <span className="text-muted-foreground shrink-0 text-[0.8125rem]">
                    {entry.count}
                    {entry.blocking ? "" : " · informational"}
                  </span>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Recent payments</CardTitle>
          <CardDescription>Confirmed payments, with the extension that followed.</CardDescription>
        </CardHeader>
        <CardContent>
          {data.recentPayments.length === 0 ? (
            <p className="text-muted-foreground py-2 text-sm">No payments yet. The first confirmed payment appears here.</p>
          ) : null}
          {data.recentPayments.map((payment) => (
            <Link
              key={payment.invoiceId}
              href={`/renewal-retention/invoices/${payment.invoiceId}`}
              className="hover:bg-accent/40 grid grid-cols-[minmax(0,1fr)_7rem_9rem] items-center gap-3 border-b py-2.5"
            >
              <span className="flex min-w-0 flex-col gap-0.5">
                <span className="text-sm">{payment.companyName ?? "Franchise"}</span>
                <span className="text-muted-foreground text-xs">
                  <span className="font-mono">{payment.invoiceNumber}</span> · {plural(payment.outlets, "outlet")} · {longDate(payment.paidAt)}
                </span>
              </span>
              <span className="text-right text-sm whitespace-nowrap tabular-nums">{money(payment.totalMinor)}</span>
              <span className={cn("text-xs", payment.extensionStatus === "failed" ? TONE_TEXT.red : payment.extensionStatus === "applied" ? TONE_TEXT.green : "text-muted-foreground")}>
                {payment.extensionStatus === "applied" ? "Licence extended" : payment.extensionStatus === "failed" ? "Extension failed" : payment.extensionStatus === "pending" ? "Extension pending" : "Paid"}
              </span>
            </Link>
          ))}
        </CardContent>
      </Card>
    </div>
  )
}

/**
 * The steps between an empty module and a first invoice, each ticked off
 * from real data and linked to the screen that completes it. Disappears once
 * everything is done. Queue-based steps read "not checked yet" until the
 * nightly check has run, never "done".
 */
function SetupChecklistCard({ setup }: { setup: Setup }) {
  const firstTodo = setup.steps.find((step) => step.state === "todo")?.key
  return (
    <Card className="border-primary/30">
      <CardHeader>
        <CardTitle className="text-base">Get renewals running</CardTitle>
        <CardDescription>
          {setup.doneCount} of {setup.steps.length} done. Each step links to where it is done, and ticks itself
          off once it is.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ol className="flex flex-col">
          {setup.steps.map((step, index) => (
            <li key={step.key} className="flex items-start gap-3 border-b py-3 last:border-b-0">
              <span className="mt-0.5 shrink-0" aria-hidden>
                {step.state === "done" ? (
                  <CheckCircle2 className="size-5 text-emerald-600" />
                ) : step.state === "not_checked" ? (
                  <Clock className="text-muted-foreground size-5" />
                ) : (
                  <Circle className={cn("size-5", step.key === firstTodo ? "text-primary" : "text-muted-foreground")} />
                )}
              </span>
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className={cn("text-sm font-medium", step.state === "done" && "text-muted-foreground line-through decoration-1")}>
                  {index + 1}. {step.title}
                </span>
                <span className="text-muted-foreground text-xs text-pretty">
                  {step.detail}
                </span>
              </span>
              {step.state === "todo" ? (
                <Button size="sm" variant={step.key === firstTodo ? "default" : "outline"} className="shrink-0" asChild>
                  <Link href={step.href}>{step.cta}</Link>
                </Button>
              ) : null}
            </li>
          ))}
        </ol>
      </CardContent>
    </Card>
  )
}
