/**
 * Display helpers for the invoice screens.
 *
 * Amounts arrive from the API in integer minor units, so nothing here parses a
 * decimal or touches a float.
 */

export function formatMinor(
  minor: number | null,
  currencyCode: string = "MYR"
): string {
  if (minor === null) {
    return "—"
  }
  const negative = minor < 0
  const absolute = Math.abs(minor)
  const grouped = String(Math.trunc(absolute / 100)).replace(
    /\B(?=(\d{3})+(?!\d))/g,
    ","
  )
  const prefix = currencyCode === "MYR" ? "RM" : `${currencyCode} `
  return `${negative ? "-" : ""}${prefix}${grouped}.${String(absolute % 100).padStart(2, "0")}`
}

export const STATUS_LABELS: Record<string, string> = {
  draft: "Draft",
  issued: "Issued",
  sent: "Sent",
  payment_pending: "Awaiting payment",
  paid: "Paid",
  lapsed: "Lapsed",
  cancelled: "Cancelled",
  superseded: "Superseded",
}

/** Tailwind classes per status, so the list reads at a glance. */
export const STATUS_CLASSES: Record<string, string> = {
  draft: "bg-muted text-muted-foreground",
  issued: "bg-blue-100 text-blue-900 dark:bg-blue-900/40 dark:text-blue-100",
  sent: "bg-blue-100 text-blue-900 dark:bg-blue-900/40 dark:text-blue-100",
  payment_pending:
    "bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-100",
  paid: "bg-emerald-100 text-emerald-900 dark:bg-emerald-900/40 dark:text-emerald-100",
  lapsed: "bg-destructive/10 text-destructive",
  cancelled: "bg-muted text-muted-foreground",
  superseded: "bg-muted text-muted-foreground",
}

export const TERM_LABELS: Record<string, string> = {
  annually: "1 year",
  bi_annually: "6 months",
}

/** `YYYY-MM-DD` or a full timestamp, rendered as a plain date. */
export function formatDateOnly(value: string | null): string {
  if (!value) {
    return "—"
  }
  return value.slice(0, 10)
}
