import type { Metadata } from "next"
import Link from "next/link"

import { Card, CardContent, CardDescription, CardHeader } from "@/components/ui/card"
import { getGeneralOverviewData } from "./data"

export const metadata: Metadata = {
  title: "General Overview",
}

type Metric = {
  label: string
  value: string
  detail: string
}

type Section = {
  title: string
  description: string
  href: string
  available: boolean
  metrics: Metric[]
}

function formatNumber(value: number): string {
  return value.toLocaleString("en-MY")
}

function formatPercent(value: number | null): string {
  if (value === null) {
    return "—"
  }
  return `${value.toFixed(1)}%`
}

function formatScore(value: number | null): string {
  if (value === null || !Number.isFinite(value) || value <= 0) {
    return "—"
  }
  return `${value.toFixed(2)} / 4`
}

export default async function OverviewPage() {
  const data = await getGeneralOverviewData()

  const sections: Section[] = [
    {
      title: "Merchant Success",
      description: "Live support queue health.",
      href: "/merchant-success/overview",
      available: data.merchantSuccess.available,
      metrics: [
        {
          label: "Active Tickets",
          value: formatNumber(data.merchantSuccess.activeTickets),
          detail: `Open ${data.merchantSuccess.activeOpen} · In progress ${data.merchantSuccess.activeInProgress} · Pending ${data.merchantSuccess.activePendingCustomer}`,
        },
        {
          label: "New Tickets Today",
          value: formatNumber(data.merchantSuccess.newToday),
          detail: "Created today",
        },
        {
          label: "Resolved Today",
          value: formatNumber(data.merchantSuccess.resolvedToday),
          detail: "Closed today",
        },
      ],
    },
    {
      title: "Sales & Marketing",
      description: "Lead intake and appointment performance.",
      href: "/sales/overview",
      available: data.sales.available,
      metrics: [
        {
          label: "Leads This Month",
          value: formatNumber(data.sales.leadsThisMonth),
          detail: "New leads this month",
        },
        {
          label: "Appointments This Month",
          value: formatNumber(data.sales.appointmentsThisMonth),
          detail: "Booked this month",
        },
        {
          label: "Completion Rate",
          value: formatPercent(data.sales.completionRate),
          detail: "Completed vs canceled",
        },
      ],
    },
    {
      title: "Merchants",
      description: "Merchant directory composition.",
      href: "/merchants",
      available: data.merchants.available,
      metrics: [
        {
          label: "Total Merchants",
          value: formatNumber(data.merchants.total),
          detail: `Live ${data.merchants.live} · Test ${data.merchants.test} · Closed ${data.merchants.closed}`,
        },
        {
          label: "Live Merchants",
          value: formatNumber(data.merchants.live),
          detail: "Active, non-test accounts",
        },
        {
          label: "Outlets",
          value: formatNumber(data.merchants.outlets),
          detail: "Total linked outlets",
        },
      ],
    },
    {
      title: "CSAT Insights",
      description: "Customer satisfaction averages.",
      href: "/merchant-success/csat-insights",
      available: data.csat.available,
      metrics: [
        {
          label: "Support Satisfaction",
          value: formatScore(data.csat.supportAverage),
          detail: "Average support rating",
        },
        {
          label: "Product Satisfaction",
          value: formatScore(data.csat.productAverage),
          detail: "Average product rating",
        },
      ],
    },
  ]

  return (
    <div className="animate-in fade-in slide-in-from-bottom-2 flex flex-col gap-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">General Overview</h1>
        <p className="text-muted-foreground mt-2 text-sm">
          An organisation-wide snapshot across all workspaces. Select a section to open
          its full dashboard.
        </p>
      </div>

      {sections.map((section) => (
        <section key={section.title} className="flex flex-col gap-4">
          <div className="flex items-end justify-between gap-4">
            <div>
              <h2 className="text-lg font-semibold tracking-tight">{section.title}</h2>
              <p className="text-muted-foreground text-sm">{section.description}</p>
            </div>
            <Link
              href={section.href}
              className="text-primary text-sm font-medium hover:underline"
            >
              View workspace →
            </Link>
          </div>

          <div className="grid gap-4 md:grid-cols-3">
            {section.metrics.map((metric) => (
              <Link key={metric.label} href={section.href} className="block">
                <Card className="hover:bg-muted/40 gap-2 transition-colors">
                  <CardHeader className="pb-1">
                    <CardDescription>{metric.label}</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-1">
                    <div className="text-2xl font-semibold">{metric.value}</div>
                    <span className="text-muted-foreground block text-xs">
                      {section.available ? metric.detail : "Data unavailable"}
                    </span>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        </section>
      ))}
    </div>
  )
}
