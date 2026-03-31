"use client"

import { Area, AreaChart, Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts"

import type { SalesOverviewData } from "./data"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart"

const trendConfig = {
  total: {
    label: "Leads",
    color: "#2563eb",
  },
} satisfies ChartConfig

const sourcesConfig = {
  total: {
    label: "Leads",
    color: "#2563eb",
  },
} satisfies ChartConfig

function buildTrailing30Days(
  rows: Array<{ day: string; total: number }>
): Array<{ day: string; label: string; total: number }> {
  const map = new Map(rows.map((r) => [r.day, r.total]))
  const result: Array<{ day: string; label: string; total: number }> = []

  for (let i = 29; i >= 0; i--) {
    const d = new Date()
    d.setDate(d.getDate() - i)
    const iso = d.toISOString().slice(0, 10)
    const label = d.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      timeZone: "UTC",
    })
    result.push({ day: iso, label, total: map.get(iso) ?? 0 })
  }

  return result
}

export function SalesOverviewCharts({ data }: { data: SalesOverviewData }) {
  const trendData = buildTrailing30Days(data.leadsByDay)

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>Lead Trend</CardTitle>
          <CardDescription>New leads over the last 30 days</CardDescription>
        </CardHeader>
        <CardContent>
          <ChartContainer config={trendConfig} className="h-[240px] w-full">
            <AreaChart data={trendData}>
              <defs>
                <linearGradient id="salesLeadTrendFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="var(--color-total)" stopOpacity={0.9} />
                  <stop offset="95%" stopColor="var(--color-total)" stopOpacity={0.15} />
                </linearGradient>
              </defs>
              <CartesianGrid vertical={false} />
              <XAxis
                dataKey="label"
                tickLine={false}
                axisLine={false}
                tickMargin={8}
                interval={6}
              />
              <YAxis
                allowDecimals={false}
                tickLine={false}
                axisLine={false}
                width={32}
              />
              <ChartTooltip
                cursor={false}
                content={
                  <ChartTooltipContent
                    indicator="dot"
                    labelFormatter={(value) => String(value)}
                  />
                }
              />
              <Area
                dataKey="total"
                type="monotone"
                fill="url(#salesLeadTrendFill)"
                stroke="var(--color-total)"
                strokeWidth={2}
              />
            </AreaChart>
          </ChartContainer>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Top Lead Sources</CardTitle>
          <CardDescription>All-time lead volume by source</CardDescription>
        </CardHeader>
        <CardContent>
          {data.topSources.length === 0 ? (
            <div className="text-muted-foreground flex h-[240px] items-center justify-center text-sm">
              No lead source data yet.
            </div>
          ) : (
            <ChartContainer config={sourcesConfig} className="h-[240px] w-full">
              <BarChart
                data={data.topSources}
                layout="vertical"
                margin={{ left: 0, right: 16 }}
              >
                <CartesianGrid horizontal={false} />
                <XAxis type="number" allowDecimals={false} tickLine={false} axisLine={false} />
                <YAxis
                  type="category"
                  dataKey="sourceLabel"
                  tickLine={false}
                  axisLine={false}
                  width={110}
                  tick={{ fontSize: 12 }}
                />
                <ChartTooltip
                  cursor={false}
                  content={
                    <ChartTooltipContent
                      indicator="dot"
                      labelFormatter={(value) => String(value)}
                    />
                  }
                />
                <Bar dataKey="total" fill="var(--color-total)" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ChartContainer>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
