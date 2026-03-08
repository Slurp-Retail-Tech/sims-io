export type AnalyticsPeriodMode = "all" | "monthly" | "yearly"

export type AnalyticsFilterQuery = {
  period?: string
  month?: string
  year?: string
  time?: string
  from?: string
}

export const ANALYTICS_FILTER_COOKIE_NAME = "merchant_success_analytics_filter"

export function parseAnalyticsFilterCookie(
  value: string | undefined
): AnalyticsFilterQuery | undefined {
  if (!value) {
    return undefined
  }

  try {
    const parsed = JSON.parse(decodeURIComponent(value)) as AnalyticsFilterQuery

    return {
      period: typeof parsed.period === "string" ? parsed.period : undefined,
      month: typeof parsed.month === "string" ? parsed.month : undefined,
      year: typeof parsed.year === "string" ? parsed.year : undefined,
      time: typeof parsed.time === "string" ? parsed.time : undefined,
      from: typeof parsed.from === "string" ? parsed.from : undefined,
    }
  } catch {
    return undefined
  }
}
