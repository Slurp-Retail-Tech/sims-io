"use client"

import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from "recharts"

import type { AnalyticsData } from "../data"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart"

const ticketChartConfig = {
  total: {
    label: "Tickets",
    color: "#367eeb",
  },
} satisfies ChartConfig

const dailyChartConfig = {
  total: {
    label: "Daily Tickets",
    color: "#367eeb",
  },
} satisfies ChartConfig

function formatHourLabel(value: string) {
  const match = value.match(/^(\d{1,2})\s(AM|PM)$/)

  if (!match) {
    return value
  }

  const [, hourText, meridiem] = match
  const hour = Number.parseInt(hourText, 10)

  if (Number.isNaN(hour)) {
    return value
  }

  const normalizedHour =
    meridiem === "AM" ? hour % 12 : hour % 12 + 12

  return String(normalizedHour).padStart(2, "0")
}

export function TicketAnalyticsCharts({ data }: { data: AnalyticsData }) {
  const hourly = data.hourly
  const daily = data.daily

  return (
    <div className="grid gap-6">
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Hourly Ticket Distribution</CardTitle>
            <CardDescription>Deep view of ticket volume by each hour</CardDescription>
          </CardHeader>
          <CardContent>
            <ChartContainer config={ticketChartConfig} className="h-[360px] w-full">
              <AreaChart data={hourly}>
                <defs>
                  <linearGradient id="ticketsHourlyFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="var(--color-total)" stopOpacity={0.9} />
                    <stop offset="95%" stopColor="var(--color-total)" stopOpacity={0.25} />
                  </linearGradient>
                </defs>
                <CartesianGrid vertical={false} />
                <XAxis
                  dataKey="label"
                  tickLine={false}
                  axisLine={false}
                  tickMargin={8}
                  interval={1}
                  tickFormatter={(value) => formatHourLabel(String(value))}
                />
                <YAxis allowDecimals={false} tickLine={false} axisLine={false} width={32} />
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
                  type="natural"
                  fill="url(#ticketsHourlyFill)"
                  stroke="var(--color-total)"
                  strokeWidth={2}
                />
              </AreaChart>
            </ChartContainer>
          </CardContent>
        </Card>

        <Card className="pt-0">
          <CardHeader className="flex items-center gap-2 space-y-0 border-b py-5 sm:flex-row">
            <div className="grid flex-1 gap-1">
              <CardTitle>Daily Ticket Trend</CardTitle>
              <CardDescription>Full trend for the selected period</CardDescription>
            </div>
          </CardHeader>
          <CardContent className="px-2 pt-4 sm:px-6 sm:pt-6">
            <ChartContainer config={dailyChartConfig} className="h-[300px] w-full">
              <AreaChart data={daily}>
                <defs>
                  <linearGradient id="ticketsDailyFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="var(--color-total)" stopOpacity={0.8} />
                    <stop offset="95%" stopColor="var(--color-total)" stopOpacity={0.1} />
                  </linearGradient>
                </defs>
                <CartesianGrid vertical={false} />
                <XAxis
                  dataKey="day"
                  tickLine={false}
                  axisLine={false}
                  tickMargin={8}
                  minTickGap={32}
                  tickFormatter={(value) => {
                    const date = new Date(`${value}T00:00:00`)
                    return date.toLocaleDateString("en-US", {
                      month: "short",
                      day: "numeric",
                    })
                  }}
                />
                <YAxis allowDecimals={false} tickLine={false} axisLine={false} width={32} />
                <ChartTooltip
                  cursor={false}
                  content={
                    <ChartTooltipContent
                      indicator="dot"
                      labelFormatter={(value) => {
                        const date = new Date(`${String(value)}T00:00:00`)
                        return date.toLocaleDateString("en-US", {
                          month: "short",
                          day: "numeric",
                        })
                      }}
                    />
                  }
                />
                <Area
                  dataKey="total"
                  type="natural"
                  fill="url(#ticketsDailyFill)"
                  stroke="var(--color-total)"
                  strokeWidth={2}
                />
              </AreaChart>
            </ChartContainer>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
