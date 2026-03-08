"use client"

import {
  type AnalyticsPeriodMode,
} from "../analytics/filter-state"
import { MerchantSuccessAnalyticsHeaderFilters } from "../analytics/header-filters"

export function CsatInsightsHeaderFilters({
  mode,
  selectedMonth,
  selectedYear,
  monthOptions,
  yearOptions,
}: {
  mode: AnalyticsPeriodMode
  selectedMonth: string | null
  selectedYear: string | null
  monthOptions: string[]
  yearOptions: string[]
}) {
  return (
    <MerchantSuccessAnalyticsHeaderFilters
      mode={mode}
      selectedMonth={selectedMonth}
      selectedYear={selectedYear}
      monthOptions={monthOptions}
      yearOptions={yearOptions}
    />
  )
}
