import type { Metadata } from "next"
import { cookies } from "next/headers"

import { MerchantSuccessAnalyticsHeaderFilters } from "../header-filters"
import {
  ANALYTICS_FILTER_COOKIE_NAME,
  parseAnalyticsFilterCookie,
} from "../filter-state"
import {
  getAnalyticsAvailablePeriods,
  getMerchantSuccessAnalyticsData,
  resolveAnalyticsFilter,
  toValidDateInput,
} from "../data"
import { TicketAnalyticsCharts } from "./charts"

export const metadata: Metadata = {
  title: "Merchant Success Analytics - Tickets",
}

export default async function MerchantSuccessTicketsAnalyticsPage({
  searchParams,
}: {
  searchParams?: Promise<{
    period?: string
    time?: string
    month?: string
    year?: string
    from?: string
    to?: string
  }>
}) {
  const params = searchParams ? await searchParams : undefined
  const cookieStore = await cookies()
  const persistedFilter = parseAnalyticsFilterCookie(
    cookieStore.get(ANALYTICS_FILTER_COOKIE_NAME)?.value
  )
  const { months: monthOptions, years: yearOptions } =
    await getAnalyticsAvailablePeriods()

  const { mode, selectedMonth, selectedYear, fromDate, toDate } =
    resolveAnalyticsFilter({
      query: {
        period: params?.period ?? persistedFilter?.period,
        time: params?.time,
        month: params?.month ?? persistedFilter?.month,
        year: params?.year ?? persistedFilter?.year,
        from: toValidDateInput(params?.from) ?? undefined,
      },
      availableMonths: monthOptions,
      availableYears: yearOptions,
    })

  const data = await getMerchantSuccessAnalyticsData({ mode, fromDate, toDate })

  return (
    <div className="animate-in fade-in slide-in-from-bottom-2 flex flex-col gap-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Ticket Analytics</h1>
          <p className="text-muted-foreground text-sm">Deep-dive on hourly and daily ticket behavior.</p>
        </div>
        <MerchantSuccessAnalyticsHeaderFilters
          mode={mode}
          selectedMonth={selectedMonth}
          selectedYear={selectedYear}
          monthOptions={monthOptions}
          yearOptions={yearOptions}
        />
      </div>
      <TicketAnalyticsCharts data={data} />
    </div>
  )
}
