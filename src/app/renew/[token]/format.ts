/**
 * Display helpers for the merchant-facing renewal pages.
 *
 * Amounts arrive from the API in integer minor units; nothing here parses a
 * decimal. Dates arrive as `YYYY-MM-DD` and are read literally, never through
 * `Date`, so a merchant west of Kuala Lumpur does not see yesterday.
 */

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
]

/** `RM 8,400.00`, spaced as the design writes it. */
export function money(minor: number | null | undefined, currency = "MYR"): string {
  if (minor === null || minor === undefined) {
    return "—"
  }
  const negative = minor < 0
  const absolute = Math.abs(minor)
  const whole = String(Math.trunc(absolute / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, ",")
  const prefix = currency === "MYR" ? "RM " : `${currency} `
  return `${negative ? "-" : ""}${prefix}${whole}.${String(absolute % 100).padStart(2, "0")}`
}

/** `2026-10-02` → `2 Oct 2026`. */
export function longDate(value: string | null | undefined): string {
  if (!value) {
    return "—"
  }
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value)
  if (!match) {
    return value
  }
  return `${Number(match[3])} ${MONTHS[Number(match[2]) - 1] ?? match[2]} ${match[1]}`
}

/** `2026-10-02 06:12:00.000` (UTC) → `2 Oct 2026, 14:12` in Kuala Lumpur. */
export function longDateTime(value: string | null | undefined): string {
  if (!value) {
    return "—"
  }
  const iso = value.includes("T") ? value : `${value.replace(" ", "T")}Z`
  const date = new Date(iso)
  if (Number.isNaN(date.valueOf())) {
    return value
  }
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kuala_Lumpur",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date)
}

export const TERM_LABELS: Record<string, string> = {
  annually: "1 year",
  bi_annually: "6 months",
}

export function plural(count: number, singular: string, pluralForm = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : pluralForm}`
}

export function capitalise(value: string | null | undefined): string {
  if (!value) {
    return ""
  }
  return value.charAt(0).toUpperCase() + value.slice(1)
}
