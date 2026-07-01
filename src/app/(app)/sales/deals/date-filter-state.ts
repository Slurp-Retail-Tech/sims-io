export const DEALS_DATE_FILTER_COOKIE_NAME = "deals_date_filter"

// Session-scoped UI state: 12 hours (volatile-filter tier per CLAUDE.md).
const DEALS_DATE_FILTER_COOKIE_MAX_AGE = 60 * 60 * 12

// Each field is a `YYYY-MM-DD` boundary; any subset may be set, and the three
// ranges (created / last activity / close) are combinable simultaneously.
export type DealsDateFilter = {
  createdFrom: string
  createdTo: string
  activityFrom: string
  activityTo: string
  closedFrom: string
  closedTo: string
}

export const EMPTY_DEALS_DATE_FILTER: DealsDateFilter = {
  createdFrom: "",
  createdTo: "",
  activityFrom: "",
  activityTo: "",
  closedFrom: "",
  closedTo: "",
}

const FILTER_KEYS = Object.keys(EMPTY_DEALS_DATE_FILTER) as Array<keyof DealsDateFilter>

export function countActiveDateFilters(filter: DealsDateFilter): number {
  // Count each populated from/to range as one active filter.
  let count = 0
  if (filter.createdFrom || filter.createdTo) count += 1
  if (filter.activityFrom || filter.activityTo) count += 1
  if (filter.closedFrom || filter.closedTo) count += 1
  return count
}

export function readDealsDateFilterCookie(): DealsDateFilter {
  if (typeof document === "undefined") {
    return { ...EMPTY_DEALS_DATE_FILTER }
  }
  const match = document.cookie
    .split("; ")
    .find((entry) => entry.startsWith(`${DEALS_DATE_FILTER_COOKIE_NAME}=`))
  const raw = match?.slice(DEALS_DATE_FILTER_COOKIE_NAME.length + 1)
  if (!raw) {
    return { ...EMPTY_DEALS_DATE_FILTER }
  }
  try {
    const parsed = JSON.parse(decodeURIComponent(raw)) as Partial<DealsDateFilter>
    const next = { ...EMPTY_DEALS_DATE_FILTER }
    for (const key of FILTER_KEYS) {
      if (typeof parsed[key] === "string") {
        next[key] = parsed[key] as string
      }
    }
    return next
  } catch {
    return { ...EMPTY_DEALS_DATE_FILTER }
  }
}

export function writeDealsDateFilterCookie(filter: DealsDateFilter): void {
  if (typeof document === "undefined") {
    return
  }
  const value = encodeURIComponent(JSON.stringify(filter))
  document.cookie = `${DEALS_DATE_FILTER_COOKIE_NAME}=${value}; Max-Age=${DEALS_DATE_FILTER_COOKIE_MAX_AGE}; Path=/`
}
