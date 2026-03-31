"use client"

import * as React from "react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"

import {
  SALES_ANALYTICS_FILTER_COOKIE_NAME,
  type SalesPeriodMode,
} from "../filter-state"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

const COOKIE_MAX_AGE = 60 * 60 * 12

function setSalesFilterCookie({
  mode,
  selectedMonth,
  selectedYear,
}: {
  mode: SalesPeriodMode
  selectedMonth: string | null
  selectedYear: string | null
}) {
  if (typeof document === "undefined") return

  const payload = encodeURIComponent(
    JSON.stringify({ period: mode, month: selectedMonth, year: selectedYear })
  )

  document.cookie = `${SALES_ANALYTICS_FILTER_COOKIE_NAME}=${payload}; Max-Age=${COOKIE_MAX_AGE}; Path=/`
}

function getMonthName(monthValue: string): string {
  const [yearText, monthText] = monthValue.split("-")
  const year = Number(yearText)
  const month = Number(monthText)
  if (!Number.isFinite(year) || !Number.isFinite(month)) return monthValue
  const date = new Date(Date.UTC(year, month - 1, 1))
  return date.toLocaleDateString("en-US", { month: "long", timeZone: "UTC" })
}

export function SalesAnalyticsHeaderFilters({
  mode,
  selectedMonth,
  selectedYear,
  monthOptions,
  yearOptions,
}: {
  mode: SalesPeriodMode
  selectedMonth: string | null
  selectedYear: string | null
  monthOptions: string[]
  yearOptions: string[]
}) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const selectedFilterYear =
    mode === "all"
      ? null
      : selectedYear ??
        (selectedMonth ? selectedMonth.slice(0, 4) : null) ??
        yearOptions[0] ??
        null

  const filterType = mode === "all" ? "all" : (selectedFilterYear ?? "all")

  const valueOptions = React.useMemo(() => {
    if (!selectedFilterYear) return [] as Array<{ value: string; label: string }>
    const yearMonths = monthOptions.filter((m) => m.startsWith(`${selectedFilterYear}-`))
    return [
      { value: `year:${selectedFilterYear}`, label: "All Year" },
      ...yearMonths.map((m) => ({ value: `month:${m}`, label: getMonthName(m) })),
    ]
  }, [monthOptions, selectedFilterYear])

  const selectedValue =
    mode === "monthly"
      ? (selectedMonth ? `month:${selectedMonth}` : "")
      : mode === "yearly"
        ? (selectedFilterYear ? `year:${selectedFilterYear}` : "")
        : ""

  React.useEffect(() => {
    setSalesFilterCookie({ mode, selectedMonth, selectedYear })
  }, [mode, selectedMonth, selectedYear])

  const updateQuery = React.useCallback(
    ({
      nextMode,
      nextMonth,
      nextYear,
    }: {
      nextMode: SalesPeriodMode
      nextMonth?: string | null
      nextYear?: string | null
    }) => {
      const resolvedMonth =
        nextMode === "monthly" ? (nextMonth ?? monthOptions[0] ?? null) : null
      const resolvedYear =
        nextMode === "yearly" ? (nextYear ?? yearOptions[0] ?? null) : null

      setSalesFilterCookie({
        mode: nextMode,
        selectedMonth: resolvedMonth,
        selectedYear: resolvedYear,
      })

      const params = new URLSearchParams(searchParams.toString())
      params.set("period", nextMode)

      if (nextMode === "monthly") {
        if (resolvedMonth) params.set("month", resolvedMonth)
        else params.delete("month")
        params.delete("year")
      } else if (nextMode === "yearly") {
        if (resolvedYear) params.set("year", resolvedYear)
        else params.delete("year")
        params.delete("month")
      } else {
        params.delete("month")
        params.delete("year")
      }

      const query = params.toString()
      router.push(query ? `${pathname}?${query}` : pathname)
    },
    [monthOptions, pathname, router, searchParams, yearOptions]
  )

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Select
        value={filterType}
        onValueChange={(value) => {
          if (value === "all") {
            updateQuery({ nextMode: "all", nextMonth: null, nextYear: null })
            return
          }
          const yearValue = yearOptions.includes(value) ? value : (yearOptions[0] ?? null)
          updateQuery({ nextMode: "yearly", nextYear: yearValue, nextMonth: null })
        }}
      >
        <SelectTrigger className="h-9 w-[155px]">
          <SelectValue placeholder="Filter by year" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All Time</SelectItem>
          {yearOptions.map((year) => (
            <SelectItem key={year} value={year}>
              {year}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select
        value={selectedValue}
        onValueChange={(value) => {
          if (value.startsWith("month:")) {
            updateQuery({ nextMode: "monthly", nextMonth: value.replace("month:", "") })
            return
          }
          if (value.startsWith("year:")) {
            updateQuery({ nextMode: "yearly", nextYear: value.replace("year:", "") })
          }
        }}
        disabled={filterType === "all" || !valueOptions.length}
      >
        <SelectTrigger className="h-9 w-[205px]">
          <SelectValue
            placeholder={filterType === "all" ? "No period selection" : "All Year or Month"}
          />
        </SelectTrigger>
        <SelectContent>
          {valueOptions.map((item) => (
            <SelectItem key={item.value} value={item.value}>
              {item.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}
