"use client"

import { Fragment } from "react"
import { Area, AreaChart, Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts"

import type { AnalyticsData } from "../data"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart"

const volumeConfig = {
  open: {
    label: "Open",
    color: "#367eeb",
  },
  resolved: {
    label: "Resolved",
    color: "#9bc0ee",
  },
} satisfies ChartConfig

const productivityConfig = {
  totalTickets: {
    label: "Total Tickets",
    color: "#1d4ed8",
  },
  ticketsPerDay: {
    label: "Tickets/Day",
    color: "#367eeb",
  },
  avgResolveMinutes: {
    label: "Avg Resolve (hrs)",
    color: "#9bc0ee",
  },
} satisfies ChartConfig

function formatMsMetricValue(value: unknown, metricName: string | number | undefined) {
  if (typeof value !== "number") {
    return String(value ?? "--")
  }

  if (metricName === "ticketsPerDay") {
    return value.toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })
  }

  if (metricName === "avgResolveMinutes") {
    return value.toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })
  }

  return Math.round(value).toLocaleString("en-US")
}

function formatDecimal(value: number) {
  return value.toLocaleString("en-US", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  })
}

export function MsAnalyticsCharts({ data }: { data: AnalyticsData }) {
  const msRows = data.msBreakdown.map((row) => ({
    name: row.name,
    open: row.totalTickets,
    resolved: row.resolvedTickets,
    totalTickets: row.totalTickets,
    ticketsPerDay: Number(row.ticketsPerDay.toFixed(2)),
    avgResolveMinutes: Number(((row.avgResolveMinutes ?? 0) / 60).toFixed(2)),
  }))
  const msPivotSections = data.msMonths
    .map((month) => {
      const rows = data.msPivotRows.filter((row) => row.monthKey === month.key)
      const totalTickets = rows.reduce((sum, row) => sum + row.totalTickets, 0)
      const durationMinutes = rows.reduce((sum, row) => sum + row.durationMinutes, 0)
      const avgDurationMinutes = totalTickets > 0 ? durationMinutes / totalTickets : 0

      return {
        monthKey: month.key,
        monthLabel: month.label,
        rows,
        totalTickets,
        durationMinutes,
        avgDurationMinutes,
        avgDurationHours: avgDurationMinutes / 60,
      }
    })
    .filter((section) => section.rows.length > 0)

  return (
    <div className="grid gap-6">
      <Card>
        <CardHeader>
          <CardTitle>Tickets per MS PIC</CardTitle>
          <CardDescription>Assigned and resolved ticket volume by MS</CardDescription>
        </CardHeader>
        <CardContent>
          <ChartContainer config={volumeConfig} className="h-[380px] w-full">
            <BarChart accessibilityLayer data={msRows}>
              <CartesianGrid vertical={false} />
              <XAxis
                dataKey="name"
                tick={{ fontSize: 11 }}
                interval={0}
                angle={-12}
                textAnchor="end"
                height={58}
                tickLine={false}
                axisLine={false}
              />
              <YAxis allowDecimals={false} tickLine={false} axisLine={false} width={32} />
              <ChartTooltip
                cursor={false}
                content={
                  <ChartTooltipContent
                    indicator="dashed"
                    labelFormatter={(value) => String(value)}
                  />
                }
              />
              <ChartLegend content={<ChartLegendContent />} />
              <Bar
                dataKey="open"
                fill="var(--color-open)"
                radius={4}
              />
              <Bar
                dataKey="resolved"
                fill="var(--color-resolved)"
                radius={4}
              />
            </BarChart>
          </ChartContainer>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>MS Productivity and Resolve Time</CardTitle>
          <CardDescription>Total tickets, tickets/day, and average resolve time per MS.</CardDescription>
        </CardHeader>
        <CardContent>
          <ChartContainer config={productivityConfig} className="h-[380px] w-full">
            <AreaChart data={msRows}>
              <defs>
                <linearGradient id="msTotalTicketsFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="var(--color-totalTickets)" stopOpacity={0.9} />
                  <stop offset="95%" stopColor="var(--color-totalTickets)" stopOpacity={0.1} />
                </linearGradient>
                <linearGradient id="msTicketsPerDayFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="var(--color-ticketsPerDay)" stopOpacity={0.75} />
                  <stop offset="95%" stopColor="var(--color-ticketsPerDay)" stopOpacity={0.08} />
                </linearGradient>
                <linearGradient id="msResolveMinutesFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="var(--color-avgResolveMinutes)" stopOpacity={0.7} />
                  <stop offset="95%" stopColor="var(--color-avgResolveMinutes)" stopOpacity={0.08} />
                </linearGradient>
              </defs>
              <CartesianGrid vertical={false} />
              <XAxis
                dataKey="name"
                tickLine={false}
                axisLine={false}
                tickMargin={8}
                minTickGap={24}
                tick={{ fontSize: 11 }}
              />
              <YAxis yAxisId="left" allowDecimals={false} tickLine={false} axisLine={false} width={32} />
              <YAxis
                yAxisId="right"
                orientation="right"
                tickLine={false}
                axisLine={false}
                width={52}
                tickFormatter={(value) =>
                  Number(value).toLocaleString("en-US", {
                    minimumFractionDigits: 1,
                    maximumFractionDigits: 1,
                  })
                }
              />
              <ChartTooltip
                cursor={false}
                content={
                  <ChartTooltipContent
                    indicator="dot"
                    labelFormatter={(value) => String(value)}
                    formatter={(value, name) => formatMsMetricValue(value, name)}
                  />
                }
              />
              <ChartLegend content={<ChartLegendContent />} />
              <Area
                yAxisId="right"
                dataKey="avgResolveMinutes"
                type="natural"
                fill="url(#msResolveMinutesFill)"
                stroke="var(--color-avgResolveMinutes)"
                strokeWidth={2}
              />
              <Area
                yAxisId="left"
                dataKey="ticketsPerDay"
                type="natural"
                fill="url(#msTicketsPerDayFill)"
                stroke="var(--color-ticketsPerDay)"
                strokeWidth={2}
              />
              <Area
                yAxisId="left"
                dataKey="totalTickets"
                type="natural"
                fill="url(#msTotalTicketsFill)"
                stroke="var(--color-totalTickets)"
                strokeWidth={2}
              />
            </AreaChart>
          </ChartContainer>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>MS PIC Monthly Ticket Duration Summary</CardTitle>
          <CardDescription>Monthly ticket count and duration averages by assigned MS PIC.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full min-w-[980px] text-sm">
              <thead className="bg-muted/40 text-muted-foreground">
                <tr className="border-b">
                  <th className="px-3 py-3 text-left font-semibold">Created At - Year-Month</th>
                  <th className="px-3 py-3 text-left font-semibold">Assigned MS PIC</th>
                  <th className="px-3 py-3 text-right font-semibold">Ticket Count</th>
                  <th className="px-3 py-3 text-right font-semibold">Total Duration (minutes)</th>
                  <th className="px-3 py-3 text-right font-semibold">Avg Duration (minutes)</th>
                  <th className="px-3 py-3 text-right font-semibold">Avg Duration (hours)</th>
                </tr>
              </thead>
              <tbody>
                {msPivotSections.map((section) => (
                  <Fragment key={section.monthKey}>
                    {section.rows.map((row, index) => (
                      <tr key={row.id} className="border-b last:border-b-0">
                        {index === 0 ? (
                          <td
                            className="px-3 py-2 align-top font-medium"
                            rowSpan={section.rows.length}
                          >
                            {section.monthLabel}
                          </td>
                        ) : null}
                        <td className="px-3 py-2">{row.msName}</td>
                        <td className="px-3 py-2 text-right tabular-nums">
                          {row.totalTickets.toLocaleString("en-US")}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">
                          {formatDecimal(row.durationMinutes)}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">
                          {formatDecimal(row.avgDurationMinutes)}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">
                          {formatDecimal(row.avgDurationHours)}
                        </td>
                      </tr>
                    ))}
                    <tr className="border-b bg-muted/30 font-medium">
                      <td className="px-3 py-2" colSpan={2}>
                        {section.monthLabel} Total
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {section.totalTickets.toLocaleString("en-US")}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {formatDecimal(section.durationMinutes)}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {formatDecimal(section.avgDurationMinutes)}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {formatDecimal(section.avgDurationHours)}
                      </td>
                    </tr>
                  </Fragment>
                ))}
                <tr className="bg-muted/40 font-semibold">
                  <td className="px-3 py-3" colSpan={2}>
                    Grand Total
                  </td>
                  <td className="px-3 py-3 text-right tabular-nums">
                    {data.msPivotGrandTotal.totalTickets.toLocaleString("en-US")}
                  </td>
                  <td className="px-3 py-3 text-right tabular-nums">
                    {formatDecimal(data.msPivotGrandTotal.durationMinutes)}
                  </td>
                  <td className="px-3 py-3 text-right tabular-nums">
                    {formatDecimal(data.msPivotGrandTotal.avgDurationMinutes)}
                  </td>
                  <td className="px-3 py-3 text-right tabular-nums">
                    {formatDecimal(data.msPivotGrandTotal.avgDurationHours)}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
