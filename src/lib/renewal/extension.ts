/**
 * Extending a licence after payment, and telling the POS about it.
 *
 * The one rule that matters: the new expiry is the previous expiry plus the
 * paid term. Never the payment date plus the term. A merchant who pays ten
 * days early does not lose ten days, and one who pays inside the grace window
 * does not gain any; the dates simply follow on from each other, which is what
 * the proforma promised when it printed the new expiry beside the old one.
 *
 * The base is the subscription's *current* `valid_until`, not the date the
 * invoice line captured at generation. They agree almost always. Where they
 * do not, someone renewed the outlet outside SIMS between the reminder and
 * the payment, and extending from the stale line date would hand back days
 * that were already paid for elsewhere. The difference is recorded so it can
 * be seen, not silently picked.
 *
 * Pure and runtime-free so it can be unit-tested under `node --test`.
 */

import { addMonths } from "./invoice-build.ts"

/** `2026-09-15 04:12:00.000` — a DATETIME(3) as the pool returns it, in UTC. */
const DATETIME_PATTERN = /^(\d{4}-\d{2}-\d{2})(?:[ T](\d{2}:\d{2}:\d{2})(\.\d{1,3})?)?/

export type ExtensionInput = {
  itemId: string
  outletId: string
  outletSubscriptionId: string | null
  /** The subscription's current expiry, as stored (UTC). */
  subscriptionValidUntil: string | null
  /** The expiry the invoice line recorded when it was generated. */
  linePreviousValidUntil: string | null
  termMonths: number
}

export type PlannedExtension = {
  itemId: string
  outletId: string
  outletSubscriptionId: string | null
  previousValidUntil: string
  newValidUntil: string
  termMonths: number
  /** True when the subscription had moved on from what the line recorded. */
  drifted: boolean
  linePreviousValidUntil: string | null
}

export type ExtensionPlan =
  | { ok: true; lines: PlannedExtension[] }
  | {
      ok: false
      reason: "missing_valid_until" | "invalid_term" | "no_lines"
      outletId: string | null
    }

/**
 * Move a stored expiry forward by whole months, keeping its time of day.
 *
 * Arithmetic is done on the stored UTC date part, the same date the rest of
 * the module keys on (`valid_until_date` is `DATE(valid_until)`), so the
 * cohort an outlet lands in after extension is the one its new date says.
 * Month ends clamp rather than roll over; see `addMonths`.
 */
export function extendValidUntil(previousValidUntil: string, termMonths: number): string {
  const match = DATETIME_PATTERN.exec(previousValidUntil.trim())
  if (!match) {
    throw new Error(`Not a stored DATETIME: ${previousValidUntil}`)
  }
  if (!Number.isInteger(termMonths) || termMonths <= 0) {
    throw new RangeError(`Term must be a positive number of months: ${termMonths}`)
  }
  const [, date, time, fraction] = match
  const newDate = addMonths(date, termMonths)
  const millis = (fraction ?? ".000").padEnd(4, "0").slice(0, 4)
  return `${newDate} ${time ?? "00:00:00"}${millis}`
}

/**
 * Plan every line's extension, or refuse the whole invoice.
 *
 * All or nothing: a grouped invoice with one outlet that has no expiry to
 * extend from is not half-renewed. The caller records the refusal and a
 * person resolves it, with the payment already safe.
 */
export function planExtensions(inputs: readonly ExtensionInput[]): ExtensionPlan {
  if (inputs.length === 0) {
    return { ok: false, reason: "no_lines", outletId: null }
  }

  const lines: PlannedExtension[] = []
  for (const input of inputs) {
    if (!Number.isInteger(input.termMonths) || input.termMonths <= 0) {
      return { ok: false, reason: "invalid_term", outletId: input.outletId }
    }
    const base = input.subscriptionValidUntil ?? input.linePreviousValidUntil
    if (!base || !DATETIME_PATTERN.test(base.trim())) {
      return { ok: false, reason: "missing_valid_until", outletId: input.outletId }
    }
    const drifted =
      input.subscriptionValidUntil !== null &&
      input.linePreviousValidUntil !== null &&
      dateOf(input.subscriptionValidUntil) !== dateOf(input.linePreviousValidUntil)

    lines.push({
      itemId: input.itemId,
      outletId: input.outletId,
      outletSubscriptionId: input.outletSubscriptionId,
      previousValidUntil: base,
      newValidUntil: extendValidUntil(base, input.termMonths),
      termMonths: input.termMonths,
      drifted,
      linePreviousValidUntil: input.linePreviousValidUntil,
    })
  }
  return { ok: true, lines }
}

/** The `YYYY-MM-DD` part of a stored DATETIME. */
export function dateOf(value: string): string {
  return value.trim().slice(0, 10)
}

/** Kuala Lumpur is UTC+8 with no daylight saving; the offset is a constant. */
const APP_OFFSET_MINUTES = 8 * 60

/**
 * The timestamp the POS `valid_until` endpoint takes.
 *
 * `2026-09-15T12:12:00+0800`: ISO 8601 at the Kuala Lumpur offset, spelled
 * with no colon. Neither `toISOString` (always `Z`) nor `Intl` (never emits
 * `+0800`) produces this, so it is built by hand from the stored UTC value.
 */
export function formatPosValidUntil(storedUtc: string): string {
  const match = DATETIME_PATTERN.exec(storedUtc.trim())
  if (!match) {
    throw new Error(`Not a stored DATETIME: ${storedUtc}`)
  }
  const [, date, time] = match
  const utc = new Date(`${date}T${time ?? "00:00:00"}Z`)
  if (Number.isNaN(utc.valueOf())) {
    throw new Error(`Not a stored DATETIME: ${storedUtc}`)
  }
  const local = new Date(utc.getTime() + APP_OFFSET_MINUTES * 60_000)
  const pad = (n: number) => String(n).padStart(2, "0")
  return (
    `${local.getUTCFullYear()}-${pad(local.getUTCMonth() + 1)}-${pad(local.getUTCDate())}` +
    `T${pad(local.getUTCHours())}:${pad(local.getUTCMinutes())}:${pad(local.getUTCSeconds())}+0800`
  )
}
