export type SalesPeriodMode = "all" | "monthly" | "yearly"

export type SalesFilterQuery = {
  period?: string
  month?: string
  year?: string
}

export const SALES_ANALYTICS_FILTER_COOKIE_NAME = "sales_analytics_filter"

export function parseSalesFilterCookie(
  value: string | undefined
): SalesFilterQuery | undefined {
  if (!value) {
    return undefined
  }

  try {
    const parsed = JSON.parse(decodeURIComponent(value)) as SalesFilterQuery

    return {
      period: typeof parsed.period === "string" ? parsed.period : undefined,
      month: typeof parsed.month === "string" ? parsed.month : undefined,
      year: typeof parsed.year === "string" ? parsed.year : undefined,
    }
  } catch {
    return undefined
  }
}
