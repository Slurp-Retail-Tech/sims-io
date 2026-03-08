"use client"

import * as React from "react"
import { ChevronDown, ChevronRight, TrendingUp } from "lucide-react"
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts"

import type { AnalyticsData } from "../data"
import { Input } from "@/components/ui/input"
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart"

const merchantFrequencyChartConfig = {
  total: {
    label: "Tickets",
    color: "#367eeb",
  },
} satisfies ChartConfig

const chartFontFamily =
  '"PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans SC", sans-serif'

const cp1252ReverseMap = new Map<string, number>([
  ["€", 0x80],
  ["‚", 0x82],
  ["ƒ", 0x83],
  ["„", 0x84],
  ["…", 0x85],
  ["†", 0x86],
  ["‡", 0x87],
  ["ˆ", 0x88],
  ["‰", 0x89],
  ["Š", 0x8a],
  ["‹", 0x8b],
  ["Œ", 0x8c],
  ["Ž", 0x8e],
  ["‘", 0x91],
  ["’", 0x92],
  ["“", 0x93],
  ["”", 0x94],
  ["•", 0x95],
  ["–", 0x96],
  ["—", 0x97],
  ["˜", 0x98],
  ["™", 0x99],
  ["š", 0x9a],
  ["›", 0x9b],
  ["œ", 0x9c],
  ["ž", 0x9e],
  ["Ÿ", 0x9f],
])

function looksLikeMojibake(value: string) {
  return /[À-ÿ]/.test(value) && !/[\u3400-\u9fff]/.test(value)
}

function toSingleByte(char: string) {
  const mapped = cp1252ReverseMap.get(char)
  if (mapped !== undefined) {
    return mapped
  }

  const code = char.charCodeAt(0)
  return code <= 0xff ? code : null
}

function repairMojibake(value: string) {
  if (!looksLikeMojibake(value)) {
    return value
  }

  const singleBytes = Array.from(value, toSingleByte)
  if (singleBytes.some((byte) => byte === null)) {
    return value
  }

  const bytes = Uint8Array.from(singleBytes as number[])
  const repaired = new TextDecoder("utf-8", { fatal: false }).decode(bytes)

  if (!repaired || repaired.includes("\uFFFD")) {
    return value
  }

  return repaired
}

function formatCellValue(value: number | undefined) {
  return value && value > 0 ? value.toLocaleString() : ""
}

function getRowClassName(rowType: AnalyticsData["merchantFrequency"]["rows"][number]["rowType"]) {
  if (rowType === "group") {
    return "bg-muted/30 font-medium"
  }

  return "bg-background"
}

export function MerchantFrequencyCharts({ data }: { data: AnalyticsData }) {
  const { months, rows } = data.merchantFrequency
  const [expandedRows, setExpandedRows] = React.useState<Set<string>>(() => new Set())
  const [searchValue, setSearchValue] = React.useState("")

  const filteredRows = React.useMemo(() => {
    const query = searchValue.trim().toLowerCase()
    if (!query) {
      return rows
    }

    const matches = new Set<string>()

    rows.forEach((row) => {
      if (row.rowType !== "group") {
        return
      }

      const fid = row.fid.toLowerCase()
      const franchiseName = row.franchiseName.toLowerCase()
      if (fid.includes(query) || franchiseName.includes(query)) {
        matches.add(row.id.replace(/^merchant:/, ""))
      }
    })

    return rows.filter((row) => {
      const merchantKey = row.id.replace(/^merchant:/, "").replace(/:issue:.*$/, "")
      return matches.has(merchantKey)
    })
  }, [rows, searchValue])

  const chartRows = React.useMemo(() => {
    return filteredRows
      .filter((row) => row.rowType === "group")
      .map((row) => ({
        id: row.id,
        label: repairMojibake(row.franchiseName),
        fid: row.fid,
        total: row.grandTotal,
      }))
      .sort((left, right) => right.total - left.total)
      .slice(0, 12)
      .reverse()
  }, [filteredRows])

  const chartSummary = React.useMemo(() => {
    if (!chartRows.length) {
      return null
    }

    const sortedRows = [...chartRows].sort((left, right) => right.total - left.total)
    const topTotal = sortedRows[0]?.total ?? 0
    const totalTickets = chartRows.reduce((sum, row) => sum + row.total, 0)

    return {
      topRows: sortedRows.filter((row) => row.total === topTotal),
      totalTickets,
    }
  }, [chartRows])

  const visibleRows = React.useMemo(() => {
    const result: typeof filteredRows = []
    let currentMerchant = ""
    let isExpanded = false

    filteredRows.forEach((row) => {
      if (row.rowType === "group") {
        currentMerchant = row.id.replace(/^merchant:/, "")
        isExpanded = expandedRows.has(currentMerchant)
        result.push(row)
        return
      }

      if (row.rowType === "detail" && isExpanded) {
        result.push(row)
      }
    })

    return result
  }, [expandedRows, filteredRows])

  const toggleMerchant = React.useCallback((merchantKey: string) => {
    setExpandedRows((current) => {
      const next = new Set(current)
      if (next.has(merchantKey)) {
        next.delete(merchantKey)
      } else {
        next.add(merchantKey)
      }
      return next
    })
  }, [])

  return (
    <div className="grid gap-6">
      <Card>
        <CardHeader>
          <CardTitle>Franchise Ticket Volume</CardTitle>
          <CardDescription>
            Top franchises by total ticket count for the current Merchant Frequency selection.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {chartRows.length ? (
            <ChartContainer
              config={merchantFrequencyChartConfig}
              className="h-[420px] w-full"
              style={{ fontFamily: chartFontFamily }}
            >
              <BarChart
                accessibilityLayer
                data={chartRows}
                layout="vertical"
                margin={{
                  left: -20,
                  right: 12,
                }}
              >
                <CartesianGrid horizontal={false} />
                <XAxis type="number" dataKey="total" hide />
                <YAxis
                  type="category"
                  dataKey="label"
                  tickLine={false}
                  tickMargin={10}
                  axisLine={false}
                  width={280}
                  tick={{ fontSize: 12, fontFamily: chartFontFamily }}
                />
                <ChartTooltip
                  cursor={false}
                  content={
                    <ChartTooltipContent
                      indicator="dot"
                      labelFormatter={(_, payload) => {
                        const row = payload?.[0]?.payload as { label?: string; fid?: string } | undefined
                        return row ? `${row.label} • FID ${row.fid}` : ""
                      }}
                    />
                  }
                />
                <Bar dataKey="total" fill="var(--color-total)" radius={5} />
              </BarChart>
            </ChartContainer>
          ) : (
            <div className="text-muted-foreground flex h-[220px] items-center justify-center text-sm">
              No chart data matches that FID or franchise name.
            </div>
          )}
        </CardContent>
        {chartSummary ? (
          <CardFooter className="flex-col items-start gap-2 text-sm">
            <div className="flex gap-2 leading-none font-medium">
              Highest volume:{" "}
              {chartSummary.topRows
                .map((row) => `${row.label} (FID ${row.fid})`)
                .join(", ")}
              <TrendingUp className="h-4 w-4" />
            </div>
            <div className="text-muted-foreground leading-none">
              Showing {chartRows.length} franchises and {chartSummary.totalTickets.toLocaleString()} tickets.
            </div>
          </CardFooter>
        ) : null}
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Merchant Frequency by Franchise, Issue Type, and Month</CardTitle>
          <CardDescription>
            Ticket counts grouped by franchise name with collapsible issue-type detail rows.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="mb-4 max-w-sm">
            <Input
              value={searchValue}
              onChange={(event) => setSearchValue(event.target.value)}
              placeholder="Search by FID or franchise name"
              aria-label="Search merchant frequency by FID or franchise name"
            />
          </div>
          <div className="overflow-x-auto rounded-lg border bg-card">
            <table className="w-full min-w-[860px] border-collapse text-sm">
              <thead>
                <tr className="bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="sticky left-0 z-20 border-b bg-muted/40 px-4 py-2 text-left font-semibold">
                    Count of Issue Type
                  </th>
                  <th className="sticky left-[320px] z-20 border-b bg-muted/40 px-4 py-2 text-left font-semibold">
                    Issue Type
                  </th>
                  <th
                    colSpan={Math.max(1, months.length + 1)}
                    className="border-b px-4 py-2 text-left font-semibold"
                  >
                    Created At - Year-Month
                  </th>
                </tr>
                <tr>
                  <th className="sticky left-0 z-20 min-w-[320px] border-b bg-muted px-4 py-3 text-left font-semibold">
                    Franchise Name
                  </th>
                  <th className="sticky left-[320px] z-20 min-w-[180px] border-b bg-muted px-4 py-3 text-left font-semibold">
                    Issue Type
                  </th>
                  {months.map((month) => (
                    <th
                      key={month.key}
                      className="min-w-[110px] border-b bg-muted px-4 py-3 text-right font-semibold"
                    >
                      {month.label}
                    </th>
                  ))}
                  <th className="min-w-[120px] border-b bg-muted px-4 py-3 text-right font-semibold">
                    Grand Total
                  </th>
                </tr>
              </thead>
              <tbody>
                {visibleRows.length ? (
                  visibleRows.map((row) => {
                    const merchantKey =
                      row.rowType === "group" ? row.id.replace(/^merchant:/, "") : ""
                    const isExpanded = merchantKey ? expandedRows.has(merchantKey) : false

                    return (
                      <tr key={row.id} className={getRowClassName(row.rowType)}>
                        <td
                          className={`sticky left-0 z-10 border-b px-4 py-2 align-top ${
                            row.rowType === "detail" ? "bg-background" : "bg-muted/30"
                          }`}
                        >
                          {row.rowType === "group" ? (
                            <button
                              type="button"
                              onClick={() => toggleMerchant(merchantKey)}
                              className="flex items-center gap-2 text-left"
                            >
                              {isExpanded ? (
                                <ChevronDown className="h-4 w-4 text-muted-foreground" />
                              ) : (
                                <ChevronRight className="h-4 w-4 text-muted-foreground" />
                              )}
                              <span>{row.franchiseName}</span>
                            </button>
                          ) : (
                            row.franchiseName
                          )}
                        </td>
                        <td
                          className={`sticky left-[320px] z-10 border-b px-4 py-2 align-top ${
                            row.rowType === "detail" ? "bg-background pl-8" : "bg-muted/30"
                          }`}
                        >
                          {row.issueType}
                        </td>
                        {months.map((month) => (
                          <td
                            key={`${row.id}-${month.key}`}
                            className="border-b px-4 py-2 text-right"
                          >
                            {formatCellValue(row.monthly[month.key])}
                          </td>
                        ))}
                        <td className="border-b px-4 py-2 text-right font-medium">
                          {row.grandTotal.toLocaleString()}
                        </td>
                      </tr>
                    )
                  })
                ) : (
                  <tr>
                    <td
                      colSpan={months.length + 3}
                      className="text-muted-foreground px-4 py-8 text-center"
                    >
                      No merchant frequency rows match that FID or franchise name.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
