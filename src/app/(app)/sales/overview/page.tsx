import type { Metadata } from "next"
import Link from "next/link"
import { CalendarCheck2, Target, TrendingUp } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
} from "@/components/ui/card"
import { getSalesOverviewData } from "./data"
import { SalesOverviewCharts } from "./charts"

export const metadata: Metadata = {
  title: "Sales Overview",
}

function formatRate(value: number | null): string {
  if (value === null) return "--"
  return `${value.toFixed(1)}%`
}

function formatDelta(value: number): string {
  if (value === 0) return "No change"
  return value > 0 ? `+${value} vs last month` : `${value} vs last month`
}

export default async function SalesOverviewPage() {
  const data = await getSalesOverviewData()

  const kpis = [
    {
      label: "Leads This Month",
      value: data.leadsThisMonth.toLocaleString(),
      delta: formatDelta(data.leadsDelta),
      positive: data.leadsDelta >= 0,
      icon: Target,
    },
    {
      label: "Appointments This Month",
      value: data.appointmentsThisMonth.toLocaleString(),
      delta: formatDelta(data.appointmentsDelta),
      positive: data.appointmentsDelta >= 0,
      icon: CalendarCheck2,
    },
    {
      label: "Completion Rate",
      value: formatRate(data.completionRate),
      delta: "Completed vs closed",
      positive: true,
      icon: TrendingUp,
    },
  ]

  return (
    <div className="animate-in fade-in slide-in-from-bottom-2 flex flex-col gap-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Sales &amp; Marketing Overview
          </h1>
          <p className="text-muted-foreground text-sm">
            Lead intake and appointment performance.
          </p>
        </div>
        <Button size="sm" asChild>
          <Link href="/sales/leads">View Leads</Link>
        </Button>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        {kpis.map((item) => {
          const Icon = item.icon
          return (
            <Card key={item.label}>
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardDescription>{item.label}</CardDescription>
                <div className="text-muted-foreground flex size-8 items-center justify-center rounded-full border">
                  <Icon className="size-4" />
                </div>
              </CardHeader>
              <CardContent className="flex items-end justify-between">
                <div className="text-2xl font-semibold">{item.value}</div>
                <span
                  className={`text-xs ${
                    item.positive
                      ? "text-emerald-600 dark:text-emerald-400"
                      : "text-rose-600 dark:text-rose-400"
                  }`}
                >
                  {item.delta}
                </span>
              </CardContent>
            </Card>
          )
        })}
      </div>

      <SalesOverviewCharts data={data} />
    </div>
  )
}
