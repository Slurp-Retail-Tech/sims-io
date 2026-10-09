/**
 * The periods Renewal Analytics offers, and the date window behind each.
 *
 * Renewals are judged by when a subscription expires, so the months that
 * matter most are the ones still ahead: the picker offers the next three
 * months, this month (the default), the eleven before it, and the current and
 * previous full years. It used to offer only the last six months.
 *
 * The same keys drive the Renewal List's `?month=` drill-through, so a figure
 * and the list behind it always cover the same window.
 *
 * Pure and runtime-free so the calendar arithmetic is unit-tested.
 */

export type AnalyticsPeriod = { key: string; from: string; to: string; label: string }

const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"]

/** Months ahead of the current one the picker offers. */
export const UPCOMING_MONTHS = 3
/** Months behind the current one the picker offers. */
export const PAST_MONTHS = 11

function lastDayOfMonth(year: number, month: number): string {
  const day = new Date(Date.UTC(year, month, 0)).getUTCDate()
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`
}

/** The window for a `YYYY-MM` or `YYYY` key, or null for anything else. */
export function periodForKey(key: string): AnalyticsPeriod | null {
  const monthMatch = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(key)
  if (monthMatch) {
    const year = Number(monthMatch[1])
    const month = Number(monthMatch[2])
    return { key, from: `${key}-01`, to: lastDayOfMonth(year, month), label: `${MONTH_NAMES[month - 1]} ${year}` }
  }
  if (/^\d{4}$/.test(key)) {
    return { key, from: `${key}-01-01`, to: `${key}-12-31`, label: `Full year ${key}` }
  }
  return null
}

/**
 * The picker's periods, newest first, and the one selected.
 *
 * An unknown or out-of-range key falls back to the current month rather than
 * failing: it usually means a bookmarked link from a month since rolled off.
 */
export function resolvePeriod(key: string | null, today: string): { period: AnalyticsPeriod; periods: AnalyticsPeriod[] } {
  const [year, month] = today.split("-").map(Number)
  const periods: AnalyticsPeriod[] = []
  for (let offset = UPCOMING_MONTHS; offset >= -PAST_MONTHS; offset -= 1) {
    const date = new Date(Date.UTC(year, month - 1 + offset, 1))
    const monthKey = `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`
    periods.push(periodForKey(monthKey) as AnalyticsPeriod)
  }
  periods.push(periodForKey(String(year)) as AnalyticsPeriod, periodForKey(String(year - 1)) as AnalyticsPeriod)

  const currentKey = today.slice(0, 7)
  const period = periods.find((entry) => entry.key === key) ?? periods.find((entry) => entry.key === currentKey) ?? periods[0]
  return { period, periods }
}
