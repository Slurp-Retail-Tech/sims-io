/**
 * Display formatting for the catalog, in the browser.
 *
 * Amounts arrive from the API already in integer minor units, so nothing here
 * parses a decimal string or touches a float. This mirrors
 * `formatMinorForDisplay` in `src/lib/renewal/money.ts`; it is repeated rather
 * than imported to keep the client bundle free of the server module's
 * dependencies, the same split `contacts/types.ts` makes.
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
  const whole = Math.trunc(absolute / 100)
  const fraction = absolute % 100
  const grouped = String(whole).replace(/\B(?=(\d{3})+(?!\d))/g, ",")
  const prefix = currencyCode === "MYR" ? "RM" : `${currencyCode} `

  return `${negative ? "-" : ""}${prefix}${grouped}.${String(fraction).padStart(2, "0")}`
}

/** Minor units back into the string a price input shows. */
export function minorToInput(minor: number | null): string {
  if (minor === null) {
    return ""
  }
  const whole = Math.trunc(Math.abs(minor) / 100)
  const fraction = Math.abs(minor) % 100
  return `${minor < 0 ? "-" : ""}${whole}.${String(fraction).padStart(2, "0")}`
}
