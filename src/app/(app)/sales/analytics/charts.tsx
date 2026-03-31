"use client"

import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  XAxis,
  YAxis,
} from "recharts"

import type { SalesAnalyticsData } from "./data"
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
  ChartLegend,
  ChartLegendContent,
  type ChartConfig,
} from "@/components/ui/chart"

const leadVolumeConfig = {
  total: {
    label: "Leads",
    color: "#2563eb",
  },
} satisfies ChartConfig

const apptStatusConfig = {
  completed: {
    label: "Completed",
    color: "#16a34a",
  },
  pending: {
    label: "Pending",
    color: "#d97706",
  },
  canceled: {
    label: "Canceled",
    color: "#dc2626",
  },
} satisfies ChartConfig

const apptTypeConfig = {
  online: {
    label: "Online",
    color: "#2563eb",
  },
  physical: {
    label: "Physical",
    color: "#7c3aed",
  },
} satisfies ChartConfig

const sourcesConfig = {
  total: {
    label: "Leads",
    color: "#2563eb",
  },
} satisfies ChartConfig

const typesConfig = {
  total: {
    label: "Leads",
    color: "#0891b2",
  },
} satisfies ChartConfig

function EmptyState({ height = 240 }: { height?: number }) {
  return (
    <div
      className="text-muted-foreground flex items-center justify-center text-sm"
      style={{ height }}
    >
      No data for this period.
    </div>
  )
}

export function SalesAnalyticsCharts({ data }: { data: SalesAnalyticsData }) {
  return (
    <div className="flex flex-col gap-6">
      {/* Lead Volume — full width */}
      <Card>
        <CardHeader>
          <CardTitle>Lead Volume</CardTitle>
          <CardDescription>
            {data.bucketMode === "daily" ? "Daily lead intake" : "Monthly lead intake"}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {data.leadBuckets.length === 0 ? (
            <EmptyState />
          ) : data.bucketMode === "daily" ? (
            <ChartContainer config={leadVolumeConfig} className="h-[240px] w-full">
              <AreaChart data={data.leadBuckets}>
                <defs>
                  <linearGradient id="salesAnalyticsLeadFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="var(--color-total)" stopOpacity={0.9} />
                    <stop offset="95%" stopColor="var(--color-total)" stopOpacity={0.15} />
                  </linearGradient>
                </defs>
                <CartesianGrid vertical={false} />
                <XAxis
                  dataKey="bucket"
                  tickLine={false}
                  axisLine={false}
                  tickMargin={8}
                  interval="preserveStartEnd"
                />
                <YAxis allowDecimals={false} tickLine={false} axisLine={false} width={32} />
                <ChartTooltip
                  cursor={false}
                  content={
                    <ChartTooltipContent
                      indicator="dot"
                      labelFormatter={(v) => String(v)}
                    />
                  }
                />
                <Area
                  dataKey="total"
                  type="monotone"
                  fill="url(#salesAnalyticsLeadFill)"
                  stroke="var(--color-total)"
                  strokeWidth={2}
                />
              </AreaChart>
            </ChartContainer>
          ) : (
            <ChartContainer config={leadVolumeConfig} className="h-[240px] w-full">
              <BarChart data={data.leadBuckets}>
                <CartesianGrid vertical={false} />
                <XAxis
                  dataKey="bucket"
                  tickLine={false}
                  axisLine={false}
                  tickMargin={8}
                  interval="preserveStartEnd"
                />
                <YAxis allowDecimals={false} tickLine={false} axisLine={false} width={32} />
                <ChartTooltip
                  cursor={false}
                  content={
                    <ChartTooltipContent
                      indicator="dot"
                      labelFormatter={(v) => String(v)}
                    />
                  }
                />
                <Bar dataKey="total" fill="var(--color-total)" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ChartContainer>
          )}
        </CardContent>
      </Card>

      {/* Appointment Status + Type */}
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Appointment Status</CardTitle>
            <CardDescription>Stacked by status over time</CardDescription>
          </CardHeader>
          <CardContent>
            {data.apptStatusBuckets.length === 0 ? (
              <EmptyState />
            ) : (
              <ChartContainer config={apptStatusConfig} className="h-[240px] w-full">
                <BarChart data={data.apptStatusBuckets}>
                  <CartesianGrid vertical={false} />
                  <XAxis
                    dataKey="bucket"
                    tickLine={false}
                    axisLine={false}
                    tickMargin={8}
                    interval="preserveStartEnd"
                  />
                  <YAxis allowDecimals={false} tickLine={false} axisLine={false} width={32} />
                  <ChartTooltip
                    cursor={false}
                    content={<ChartTooltipContent indicator="dot" />}
                  />
                  <ChartLegend content={<ChartLegendContent />} />
                  <Bar
                    dataKey="completed"
                    stackId="a"
                    fill="var(--color-completed)"
                    radius={[0, 0, 0, 0]}
                  />
                  <Bar
                    dataKey="pending"
                    stackId="a"
                    fill="var(--color-pending)"
                    radius={[0, 0, 0, 0]}
                  />
                  <Bar
                    dataKey="canceled"
                    stackId="a"
                    fill="var(--color-canceled)"
                    radius={[4, 4, 0, 0]}
                  />
                </BarChart>
              </ChartContainer>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Appointment Type</CardTitle>
            <CardDescription>Online vs Physical over time</CardDescription>
          </CardHeader>
          <CardContent>
            {data.apptTypeBuckets.length === 0 ? (
              <EmptyState />
            ) : (
              <ChartContainer config={apptTypeConfig} className="h-[240px] w-full">
                <BarChart data={data.apptTypeBuckets}>
                  <CartesianGrid vertical={false} />
                  <XAxis
                    dataKey="bucket"
                    tickLine={false}
                    axisLine={false}
                    tickMargin={8}
                    interval="preserveStartEnd"
                  />
                  <YAxis allowDecimals={false} tickLine={false} axisLine={false} width={32} />
                  <ChartTooltip
                    cursor={false}
                    content={<ChartTooltipContent indicator="dot" />}
                  />
                  <ChartLegend content={<ChartLegendContent />} />
                  <Bar dataKey="online" fill="var(--color-online)" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="physical" fill="var(--color-physical)" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ChartContainer>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Top Sources + Business Types */}
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Top Lead Sources</CardTitle>
            <CardDescription>Lead volume by source</CardDescription>
          </CardHeader>
          <CardContent>
            {data.topSources.length === 0 ? (
              <EmptyState />
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
                        labelFormatter={(v) => String(v)}
                      />
                    }
                  />
                  <Bar dataKey="total" fill="var(--color-total)" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ChartContainer>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Top Business Types</CardTitle>
            <CardDescription>Lead volume by business type</CardDescription>
          </CardHeader>
          <CardContent>
            {data.topBusinessTypes.length === 0 ? (
              <EmptyState />
            ) : (
              <ChartContainer config={typesConfig} className="h-[240px] w-full">
                <BarChart
                  data={data.topBusinessTypes}
                  layout="vertical"
                  margin={{ left: 0, right: 16 }}
                >
                  <CartesianGrid horizontal={false} />
                  <XAxis type="number" allowDecimals={false} tickLine={false} axisLine={false} />
                  <YAxis
                    type="category"
                    dataKey="typeLabel"
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
                        labelFormatter={(v) => String(v)}
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
    </div>
  )
}
