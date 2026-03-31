import type { Metadata } from "next"
import { cookies } from "next/headers"

import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  SALES_ANALYTICS_FILTER_COOKIE_NAME,
  parseSalesFilterCookie,
} from "../filter-state"
import {
  getSalesAnalyticsData,
  getSalesAvailablePeriods,
  resolveSalesFilter,
} from "./data"
import { SalesAnalyticsCharts } from "./charts"
import { SalesAnalyticsHeaderFilters } from "./header-filters"

export const metadata: Metadata = {
  title: "Sales Analytics",
}

function formatRate(value: number | null): string {
  if (value === null) return "--"
  return `${value.toFixed(1)}%`
}

export default async function SalesAnalyticsPage({
  searchParams,
}: {
  searchParams?: Promise<{ period?: string; month?: string; year?: string }>
}) {
  const params = searchParams ? await searchParams : undefined
  const cookieStore = await cookies()
  const persistedFilter = parseSalesFilterCookie(
    cookieStore.get(SALES_ANALYTICS_FILTER_COOKIE_NAME)?.value
  )

  const { months: monthOptions, years: yearOptions } = await getSalesAvailablePeriods()

  const { mode, selectedMonth, selectedYear, fromDate, toDate } = resolveSalesFilter({
    query: {
      period: params?.period ?? persistedFilter?.period,
      month: params?.month ?? persistedFilter?.month,
      year: params?.year ?? persistedFilter?.year,
    },
    availableMonths: monthOptions,
    availableYears: yearOptions,
  })

  const data = await getSalesAnalyticsData({ mode, fromDate, toDate })

  const kpis = [
    {
      label: "Total Leads",
      value: data.totalLeads.toLocaleString(),
    },
    {
      label: "Archived Leads",
      value: data.archivedLeads.toLocaleString(),
    },
    {
      label: "Appointments Booked",
      value: (
        data.appointmentsPending +
        data.appointmentsCompleted +
        data.appointmentsCanceled
      ).toLocaleString(),
    },
    {
      label: "Completion Rate",
      value: formatRate(data.completionRate),
    },
    {
      label: "Cancellation Rate",
      value: formatRate(data.cancellationRate),
    },
  ]

  return (
    <div className="animate-in fade-in slide-in-from-bottom-2 flex flex-col gap-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Sales Analytics</h1>
          <p className="text-muted-foreground text-sm">
            Lead intake and appointment performance by period.
          </p>
        </div>
        <SalesAnalyticsHeaderFilters
          mode={mode}
          selectedMonth={selectedMonth}
          selectedYear={selectedYear}
          monthOptions={monthOptions}
          yearOptions={yearOptions}
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5">
        {kpis.map((kpi) => (
          <Card key={kpi.label}>
            <CardHeader className="pb-2">
              <CardDescription>{kpi.label}</CardDescription>
              <CardTitle className="text-3xl">{kpi.value}</CardTitle>
            </CardHeader>
          </Card>
        ))}
      </div>

      <SalesAnalyticsCharts data={data} />
    </div>
  )
}
