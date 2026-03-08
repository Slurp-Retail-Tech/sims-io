"use client"

import { Area, AreaChart, Cell, Legend, Pie, PieChart, CartesianGrid, XAxis, YAxis } from "recharts"

import type { AnalyticsData } from "./data"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart"

const chartPalette = [
  "#2563eb",
  "#0ea5e9",
  "#14b8a6",
  "#f59e0b",
  "#ef4444",
  "#8b5cf6",
]

const hourlyConfig = {
  total: {
    label: "Tickets",
    color: "#367eeb",
  },
} satisfies ChartConfig

const categoryConfig = {
  value: {
    label: "Tickets",
  },
  item0: {
    label: "Category 1",
    color: chartPalette[0],
  },
  item1: {
    label: "Category 2",
    color: chartPalette[1],
  },
  item2: {
    label: "Category 3",
    color: chartPalette[2],
  },
  item3: {
    label: "Category 4",
    color: chartPalette[3],
  },
  item4: {
    label: "Category 5",
    color: chartPalette[4],
  },
  item5: {
    label: "Category 6",
    color: chartPalette[0],
  },
} satisfies ChartConfig

type CategoryLegendProps = {
  payload?: Array<{
    color?: string
    value?: string | number
  }>
}

function CategoryLegend({ payload }: CategoryLegendProps) {
  if (!payload?.length) {
    return null
  }

  return (
    <div className="mx-auto flex max-w-[320px] flex-wrap items-center justify-center gap-x-4 gap-y-2 pt-1">
      {payload.map((item, index) => (
        <div
          key={`${String(item.value ?? "category")}-${index}`}
          className="flex items-center gap-1.5"
        >
          <span
            className="h-2.5 w-2.5 rounded-[2px]"
            style={{ backgroundColor: item.color ?? chartPalette[0] }}
          />
          <span className="text-muted-foreground">{item.value}</span>
        </div>
      ))}
    </div>
  )
}

export function MerchantSuccessOverviewPanels({ data }: { data: AnalyticsData }) {
  const hourly = data.hourly
  const categoryShareSource = data.categoryBreakdown.filter((row) => row.label !== "Unspecified")
  const categoryShare = (categoryShareSource.length ? categoryShareSource : data.categoryBreakdown)
    .slice(0, 6)
    .map((row, index) => ({
      name: row.label,
      value: row.total,
      fill: chartPalette[index % chartPalette.length],
    }))

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>Hourly Ticket</CardTitle>
          <CardDescription>Overall volume by hour</CardDescription>
        </CardHeader>
        <CardContent>
          <ChartContainer config={hourlyConfig} className="h-[280px] w-full">
            <AreaChart data={hourly}>
              <defs>
                <linearGradient id="overviewHourlyFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="var(--color-total)" stopOpacity={0.9} />
                  <stop offset="95%" stopColor="var(--color-total)" stopOpacity={0.25} />
                </linearGradient>
              </defs>
              <CartesianGrid vertical={false} />
              <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={8} interval={2} />
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
                fill="url(#overviewHourlyFill)"
                stroke="var(--color-total)"
                strokeWidth={2}
              />
            </AreaChart>
          </ChartContainer>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Issue Category Share</CardTitle>
          <CardDescription>Top issue categories</CardDescription>
        </CardHeader>
        <CardContent className="pb-2">
          <ChartContainer
            config={categoryConfig}
            className="mx-auto aspect-square h-[360px] max-h-[360px] pb-0 [&_.recharts-pie-label-text]:fill-foreground"
          >
            <PieChart>
              <ChartTooltip
                cursor={false}
                content={
                  <ChartTooltipContent
                    indicator="line"
                    labelFormatter={(_, payload) =>
                      String(payload[0]?.name ?? payload[0]?.payload?.name ?? "")
                    }
                  />
                }
              />
              <Pie
                data={categoryShare}
                dataKey="value"
                nameKey="name"
                cx="50%"
                cy="43%"
                outerRadius={102}
                stroke="none"
              >
                {categoryShare.map((entry, index) => (
                  <Cell key={`${entry.name}-${index}`} fill={entry.fill} />
                ))}
              </Pie>
              <Legend verticalAlign="bottom" align="center" content={<CategoryLegend />} />
            </PieChart>
          </ChartContainer>
        </CardContent>
      </Card>
    </div>
  )
}
