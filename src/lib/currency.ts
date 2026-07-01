const formatter = new Intl.NumberFormat("en-MY", {
  style: "currency",
  currency: "MYR",
})

/**
 * Formats a monetary amount as MYR currency. Returns "--" for null/undefined
 * so callers can render missing amounts without a special case.
 */
export function formatCurrency(amount: number | null | undefined): string {
  if (amount === null || amount === undefined || !Number.isFinite(amount)) {
    return "--"
  }
  return formatter.format(amount)
}
