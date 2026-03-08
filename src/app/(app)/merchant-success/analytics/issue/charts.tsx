"use client"

import { Fragment, useState } from "react"
import { ChevronDown, ChevronRight } from "lucide-react"
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  XAxis,
  YAxis,
} from "recharts"

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

const issueConfig = {
  totalTickets: {
    label: "Tickets",
    color: "#367eeb",
  },
  totalDurationHours: {
    label: "Duration (hrs)",
    color: "#9bc0ee",
  },
} satisfies ChartConfig

const categoryShareConfig = {
  totalTickets: {
    label: "Tickets",
    color: "#367eeb",
  },
} satisfies ChartConfig

const subcategoryConfig = {
  totalTickets: {
    label: "Tickets",
    color: "#367eeb",
  },
} satisfies ChartConfig

const breakdownPalette = [
  "#367eeb",
  "#5b9af0",
  "#7dafef",
  "#9bc0ee",
  "#4a88d8",
  "#6ca8f2",
  "#8db8f0",
  "#aacbf5",
]

function formatDurationHours(value: number) {
  return value.toLocaleString("en-US", {
    minimumFractionDigits: 3,
    maximumFractionDigits: 3,
  })
}

function formatDurationMinutes(value: number) {
  return Math.round(value * 60).toLocaleString("en-US")
}

function formatDurationHoursWhole(value: number) {
  return Math.round(value).toLocaleString("en-US")
}

function formatMetricValue(value: unknown, metricName: string | number | undefined) {
  if (typeof value !== "number") {
    return String(value ?? "--")
  }

  if (metricName === "totalDurationHours") {
    return formatDurationHours(value)
  }

  return value.toLocaleString("en-US")
}

export function IssueAnalyticsCharts({ data }: { data: AnalyticsData }) {
  const [expandedIssueTypes, setExpandedIssueTypes] = useState<Set<string>>(new Set())
  const categoryDurationData = data.issueCategoryDurationBreakdown.slice(0, 12)
  const categoryShareData = data.issueCategoryDurationBreakdown
    .slice(0, 8)
    .map((row) => ({
      label: row.label,
      totalTickets: row.totalTickets,
    }))
  const subcategory1Data = data.issueSubcategory1DurationBreakdown.slice(0, 10)
  const subcategory2Data = data.issueSubcategory2DurationBreakdown
    .filter((row) => row.label !== "Unspecified")
    .slice(0, 10)
  const toggleIssueType = (rowId: string) => {
    setExpandedIssueTypes((current) => {
      const next = new Set(current)
      if (next.has(rowId)) {
        next.delete(rowId)
      } else {
        next.add(rowId)
      }
      return next
    })
  }

  const visiblePivotRows = (() => {
    const rows: Array<
      AnalyticsData["issuePivotRows"][number] & {
        categoryCellLabel: string | null
        categoryCellRowSpan: number
      }
    > = []

    for (let index = 0; index < data.issuePivotRows.length; index += 1) {
      const row = data.issuePivotRows[index]

      if (row.level !== 0 || row.rowType !== "group") {
        continue
      }

      const isExpanded = expandedIssueTypes.has(row.id)

      if (!isExpanded) {
        rows.push({
          ...row,
          categoryCellLabel: row.category,
          categoryCellRowSpan: 1,
        })
        continue
      }

      const childRows: AnalyticsData["issuePivotRows"] = []
      let categorySubtotalRow: AnalyticsData["issuePivotRows"][number] | null = null

      for (let cursor = index + 1; cursor < data.issuePivotRows.length; cursor += 1) {
        const nextRow = data.issuePivotRows[cursor]

        if (nextRow.level === 0 && nextRow.rowType === "group") {
          break
        }

        if (nextRow.level === 0 && nextRow.rowType === "subtotal") {
          categorySubtotalRow = nextRow
          break
        }

        childRows.push(nextRow)
      }

      childRows.forEach((childRow, childIndex) => {
        rows.push({
          ...childRow,
          categoryCellLabel: childIndex === 0 ? row.category : null,
          categoryCellRowSpan: childIndex === 0 ? childRows.length : 1,
        })
      })

      if (categorySubtotalRow) {
        rows.push({
          ...categorySubtotalRow,
          categoryCellLabel: categorySubtotalRow.category,
          categoryCellRowSpan: 1,
        })
      }
    }

    return rows
  })()

  const renderBreakdownBarChart = (
    chartData: Array<{ label: string; totalTickets: number }>,
    config: ChartConfig,
    gradientId: string
  ) => (
    <ChartContainer config={config} className="h-full w-full">
      <BarChart
        accessibilityLayer
        data={chartData}
        layout="vertical"
        margin={{
          left: -20,
          right: 10,
        }}
      >
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="0">
            <stop offset="5%" stopColor="var(--color-totalTickets)" stopOpacity={0.95} />
            <stop offset="95%" stopColor="var(--color-totalTickets)" stopOpacity={0.35} />
          </linearGradient>
        </defs>
        <CartesianGrid horizontal={false} />
        <XAxis
          type="number"
          dataKey="totalTickets"
          tickLine={false}
          axisLine={false}
          allowDecimals={false}
        />
        <YAxis
          dataKey="label"
          type="category"
          tickLine={false}
          tickMargin={10}
          axisLine={false}
          width={140}
        />
        <ChartTooltip
          cursor={false}
          content={
            <ChartTooltipContent
              indicator="dot"
              labelFormatter={(value) => String(value)}
              formatter={(value, name) => formatMetricValue(value, name)}
            />
          }
        />
        <Bar dataKey="totalTickets" radius={5}>
          {chartData.map((entry, index) => (
            <Cell
              key={`${gradientId}-${entry.label}-${index}`}
              fill={breakdownPalette[index % breakdownPalette.length]}
            />
          ))}
        </Bar>
      </BarChart>
    </ChartContainer>
  )

  return (
    <div className="grid gap-6">
      <Card>
        <CardHeader className="flex items-center gap-2 space-y-0 border-b py-5 sm:flex-row">
          <div className="grid flex-1 gap-1">
            <CardTitle>Issue Volume vs Duration</CardTitle>
            <CardDescription>Ticket volume and summed handling hours by issue category.</CardDescription>
          </div>
        </CardHeader>
        <CardContent className="px-2 pt-4 sm:px-6 sm:pt-6">
          <ChartContainer config={issueConfig} className="aspect-auto h-[380px] w-full">
            <AreaChart data={categoryDurationData}>
              <defs>
                <linearGradient id="issueTicketsFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="var(--color-totalTickets)" stopOpacity={0.9} />
                  <stop offset="95%" stopColor="var(--color-totalTickets)" stopOpacity={0.1} />
                </linearGradient>
                <linearGradient id="issueDurationFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="var(--color-totalDurationHours)" stopOpacity={0.8} />
                  <stop offset="95%" stopColor="var(--color-totalDurationHours)" stopOpacity={0.1} />
                </linearGradient>
              </defs>
              <CartesianGrid vertical={false} />
              <XAxis
                dataKey="label"
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
                tickFormatter={(value) => formatDurationHours(Number(value))}
              />
              <ChartTooltip
                cursor={false}
                content={
                  <ChartTooltipContent
                    indicator="dot"
                    labelFormatter={(value) => String(value)}
                    formatter={(value, name) => formatMetricValue(value, name)}
                  />
                }
              />
              <Area
                yAxisId="right"
                dataKey="totalDurationHours"
                type="natural"
                fill="url(#issueDurationFill)"
                stroke="var(--color-totalDurationHours)"
                strokeWidth={2}
              />
              <Area
                yAxisId="left"
                dataKey="totalTickets"
                type="natural"
                fill="url(#issueTicketsFill)"
                stroke="var(--color-totalTickets)"
                strokeWidth={2}
              />
              <ChartLegend content={<ChartLegendContent />} />
            </AreaChart>
          </ChartContainer>
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>Category Share</CardTitle>
            <CardDescription>Ticket volume split by issue category.</CardDescription>
          </CardHeader>
          <CardContent className="h-[320px]">
            {renderBreakdownBarChart(categoryShareData, categoryShareConfig, "issueCategoryFill")}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Subcategory 1 Breakdown</CardTitle>
            <CardDescription>Top level-1 subcategory totals from the monthly issue dataset.</CardDescription>
          </CardHeader>
          <CardContent className="h-[320px]">
            {renderBreakdownBarChart(subcategory1Data, subcategoryConfig, "issueSub1Fill")}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Subcategory 2 Breakdown</CardTitle>
            <CardDescription>Top level-2 subcategory totals from the monthly issue dataset.</CardDescription>
          </CardHeader>
          <CardContent className="h-[320px]">
            {renderBreakdownBarChart(subcategory2Data, subcategoryConfig, "issueSub2Fill")}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Issue Hierarchy Monthly Summary</CardTitle>
          <CardDescription>Monthly ticket count and summed duration hours by issue hierarchy.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full min-w-[1040px] text-sm">
              <thead className="bg-muted/40 text-muted-foreground">
                <tr className="border-b">
                  <th className="px-3 py-3 text-left font-semibold" rowSpan={2}>
                    Issue Type
                  </th>
                  <th className="px-3 py-3 text-left font-semibold" rowSpan={2}>
                    Issue Subcategory 1
                  </th>
                  <th className="px-3 py-3 text-left font-semibold" rowSpan={2}>
                    Issue Subcategory 2
                  </th>
                  {data.issueMonths.map((month) => (
                    <th
                      key={month.key}
                      className="border-l px-3 py-3 text-center font-semibold"
                      colSpan={2}
                    >
                      {month.label}
                    </th>
                  ))}
                  <th className="border-l px-3 py-3 text-center font-semibold" colSpan={2}>
                    Grand Total
                  </th>
                </tr>
                <tr className="border-b text-xs">
                  {data.issueMonths.map((month) => (
                    <Fragment key={month.key}>
                      <th className="border-l px-3 py-2 text-right font-medium">
                        Count
                      </th>
                      <th className="px-3 py-2 text-right font-medium">
                        Duration (hrs)
                      </th>
                    </Fragment>
                  ))}
                  <th className="border-l px-3 py-2 text-right font-medium">Count</th>
                  <th className="px-3 py-2 text-right font-medium">Duration (hrs)</th>
                </tr>
              </thead>
              <tbody>
                {visiblePivotRows.map((row) => (
                  <tr
                    key={row.id}
                    className={
                      row.rowType === "subtotal"
                        ? "border-b bg-muted/30 font-medium"
                        : "border-b last:border-b-0"
                    }
                  >
                    {row.categoryCellLabel ? (
                      <td className="px-3 py-2 align-top" rowSpan={row.categoryCellRowSpan}>
                        {row.level === 0 && row.rowType === "group" ? (
                          <button
                            type="button"
                            onClick={() => toggleIssueType(row.id)}
                            className="inline-flex items-center gap-2 text-left"
                          >
                            {expandedIssueTypes.has(row.id) ? (
                              <ChevronDown className="h-4 w-4 text-muted-foreground" />
                            ) : (
                              <ChevronRight className="h-4 w-4 text-muted-foreground" />
                            )}
                            <span>{row.categoryCellLabel}</span>
                          </button>
                        ) : row.rowType === "subtotal" ? (
                          row.categoryCellLabel
                        ) : (
                          <button
                            type="button"
                            onClick={() => toggleIssueType(`category:${row.categoryCellLabel}`)}
                            className="inline-flex items-center gap-2 text-left"
                          >
                            <ChevronDown className="h-4 w-4 text-muted-foreground" />
                            <span>{row.categoryCellLabel}</span>
                          </button>
                        )}
                      </td>
                    ) : null}
                    <td className={`px-3 py-2 align-top ${row.level === 1 ? "pl-6" : ""}`}>
                      {row.rowType === "subtotal"
                        ? ""
                        : row.level === 1
                          ? row.subcategory1
                          : ""}
                    </td>
                    <td className={`px-3 py-2 align-top ${row.level === 2 ? "pl-8" : ""}`}>
                      {row.rowType === "subtotal"
                        ? ""
                        : row.level === 2
                          ? row.subcategory2
                          : ""}
                    </td>
                    {data.issueMonths.map((month) => {
                      const metric = row.monthly[month.key] ?? {
                        totalTickets: 0,
                        durationHours: 0,
                      }

                      return (
                        <Fragment key={`${row.id}-${month.key}`}>
                          <td className="border-l px-3 py-2 text-right tabular-nums">
                            {metric.totalTickets.toLocaleString("en-US")}
                          </td>
                          <td
                            className="px-3 py-2 text-right tabular-nums"
                            title={`${formatDurationMinutes(metric.durationHours)} mins`}
                          >
                            {formatDurationHoursWhole(metric.durationHours)}
                          </td>
                        </Fragment>
                      )
                    })}
                    <td className="border-l px-3 py-2 text-right tabular-nums">
                      {row.grandTotalTickets.toLocaleString("en-US")}
                    </td>
                    <td
                      className="px-3 py-2 text-right tabular-nums"
                      title={`${formatDurationMinutes(row.grandTotalDurationHours)} mins`}
                    >
                      {formatDurationHoursWhole(row.grandTotalDurationHours)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
