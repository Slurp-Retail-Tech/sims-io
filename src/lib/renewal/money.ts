/**
 * Money arithmetic for the renewal module, in integer minor units (sen).
 *
 * Every amount in this module is an integer count of sen. Nothing here goes
 * near a floating-point multiplication, because `0.1 + 0.2` is the reason
 * invoice totals drift by a cent and nobody can say which line caused it.
 *
 * Two boundaries matter:
 *
 *  - MySQL. Amounts are stored as DECIMAL(12,2) and mysql2 hands DECIMAL back
 *    as a *string*, precisely so precision survives the trip. Parse it here;
 *    never coerce it through `Number` first and round afterwards.
 *  - CommercePay. Its `amount` field is already integer minor units
 *    (`1000` = `10.00`), so the conversion at the gateway is the identity
 *    function -- but it is named, so a reader can see the units were
 *    considered rather than assumed.
 *
 * Pure and runtime-free so it can be unit-tested under `node --test`.
 */

/** Sen per ringgit. MYR only; multi-currency is out of scope. */
const MINOR_UNITS_PER_MAJOR = 100

/** DECIMAL(12,2) holds ten integer digits, so this is the storable ceiling. */
export const MAX_STORABLE_MINOR = 9_999_999_999_99

export type TaxBreakdown = {
  subtotalMinor: number
  taxMinor: number
  totalMinor: number
}

/**
 * Parse a DECIMAL column value into minor units.
 *
 * Accepts the string mysql2 returns for DECIMAL, and a number for the
 * convenience of callers holding a literal. Returns null for null, undefined,
 * empty, or anything that is not a plain decimal -- a bad value must not
 * silently become 0, because 0 is a price a merchant could be charged.
 *
 * More than two decimal places is rejected rather than rounded. A price with
 * three places did not come from a DECIMAL(12,2) column, so the caller is
 * holding something it has misunderstood.
 */
export function parseAmountToMinor(
  value: string | number | null | undefined
): number | null {
  if (value === null || value === undefined) {
    return null
  }

  const raw = typeof value === "number" ? String(value) : value.trim()
  if (!raw) {
    return null
  }

  const match = /^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(raw)
  if (!match) {
    return null
  }

  const [, sign, whole, fraction = ""] = match
  const minor =
    Number(whole) * MINOR_UNITS_PER_MAJOR + Number(fraction.padEnd(2, "0"))

  // Past what DECIMAL(12,2) can hold is not an amount SIMS can store, so it
  // is refused here, where staff input is parsed, rather than failing as a
  // database error on write.
  if (!Number.isSafeInteger(minor) || minor > MAX_STORABLE_MINOR) {
    return null
  }

  return sign === "-" ? -minor : minor
}

/**
 * Render minor units as the string to write back into a DECIMAL column.
 *
 * Always two decimal places, no thousands separators, no currency symbol.
 * This is a storage format, not a display one.
 */
export function formatMinorAsDecimalString(minor: number): string {
  if (!Number.isSafeInteger(minor)) {
    throw new RangeError(`Amount is not a safe integer: ${minor}`)
  }
  // A computed total (a sum of lines, tax on top) can outgrow the column even
  // when every input fitted. Refuse it before MySQL truncates or rejects it.
  if (Math.abs(minor) > MAX_STORABLE_MINOR) {
    throw new RangeError(`Amount exceeds DECIMAL(12,2): ${minor}`)
  }

  const negative = minor < 0
  const absolute = Math.abs(minor)
  const whole = Math.trunc(absolute / MINOR_UNITS_PER_MAJOR)
  const fraction = absolute % MINOR_UNITS_PER_MAJOR

  return `${negative ? "-" : ""}${whole}.${String(fraction).padStart(2, "0")}`
}

/**
 * Render minor units for a person to read, with thousands separators.
 *
 * Used on invoice documents and in the UI. `RM` rather than a symbol, matching
 * how Slurp writes prices elsewhere, and because the PDF renderer is limited to
 * the standard fonts and cannot be trusted with an arbitrary glyph.
 */
export function formatMinorForDisplay(
  minor: number,
  currencyCode: string = "MYR"
): string {
  const decimal = formatMinorAsDecimalString(minor)
  const negative = decimal.startsWith("-")
  const [whole, fraction] = (negative ? decimal.slice(1) : decimal).split(".")
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",")
  const prefix = currencyCode === "MYR" ? "RM" : `${currencyCode} `

  return `${negative ? "-" : ""}${prefix}${grouped}.${fraction}`
}

/** Sum line amounts. Separate from a bare reduce so overflow is caught once. */
export function sumMinor(values: readonly number[]): number {
  let total = 0
  for (const value of values) {
    total += value
  }
  if (!Number.isSafeInteger(total)) {
    throw new RangeError("Amount total overflowed the safe integer range")
  }
  return total
}

/**
 * Apply tax **exclusively**: calculated on the subtotal and added to it.
 *
 * Plan prices are never tax-inclusive. Slurp is not SST-registered today, so
 * the configured rate is 0 and the tax line is suppressed on the document --
 * but registering later is then a settings change rather than a code change,
 * which is only true if the arithmetic was exclusive from the start.
 *
 * The rate arrives as a DECIMAL(5,2) percent ("8.00"). It is converted to
 * basis points so the whole calculation stays in integers, and rounded half
 * away from zero at the end.
 */
export function applyTaxExclusive(
  subtotalMinor: number,
  taxRatePercent: string | number | null | undefined
): TaxBreakdown {
  const rateBasisPoints = parseAmountToMinor(taxRatePercent)

  if (rateBasisPoints === null || rateBasisPoints === 0) {
    return { subtotalMinor, taxMinor: 0, totalMinor: subtotalMinor }
  }

  const scaled = subtotalMinor * rateBasisPoints
  if (!Number.isSafeInteger(scaled)) {
    throw new RangeError("Tax calculation overflowed the safe integer range")
  }

  const taxMinor = roundHalfAwayFromZero(scaled, 10_000)

  return {
    subtotalMinor,
    taxMinor,
    totalMinor: sumMinor([subtotalMinor, taxMinor]),
  }
}

/**
 * The difference an override makes: effective less catalog.
 *
 * Negative for a reduction, positive for an increase. Never absolute -- the
 * sign is the whole point, because Analytics reports reductions and increases
 * separately rather than netting them to zero.
 */
export function adjustmentMinor(
  catalogMinor: number,
  effectiveMinor: number
): number {
  return effectiveMinor - catalogMinor
}

/**
 * Absolute variance of an effective price from the catalog price, in percent.
 *
 * Absolute because the approval threshold applies in both directions: an
 * unexplained increase is as much a control concern as an unapproved
 * reduction. Returns null when there is no catalog price to vary from, which
 * the caller must treat as "cannot decide", not as "within threshold".
 */
export function variancePercent(
  catalogMinor: number | null,
  effectiveMinor: number | null
): number | null {
  if (catalogMinor === null || effectiveMinor === null || catalogMinor === 0) {
    return null
  }

  const difference = Math.abs(effectiveMinor - catalogMinor)
  return (difference / Math.abs(catalogMinor)) * 100
}

/**
 * Convert to the integer units CommercePay's `amount` field expects.
 *
 * Its documentation gives `1000` = `10.00`, which is minor units, so this is a
 * pass-through. It exists to make the units explicit at the one place they
 * leave SIMS, and to refuse a negative or fractional amount before the gateway
 * does.
 */
export function toGatewayMinorUnits(minor: number): number {
  if (!Number.isSafeInteger(minor) || minor <= 0) {
    throw new RangeError(`Cannot charge a non-positive amount: ${minor}`)
  }
  return minor
}

/**
 * Integer division rounding half away from zero.
 *
 * `Math.round` rounds half *up*, which is asymmetric for negatives: -0.5
 * becomes -0, not -1. Amounts here can be negative (a reduction), so the
 * asymmetry would quietly favour one direction.
 */
function roundHalfAwayFromZero(numerator: number, denominator: number): number {
  const sign = numerator < 0 ? -1 : 1
  return sign * Math.round(Math.abs(numerator) / denominator)
}
