/**
 * Turning a set of due subscriptions into an invoice.
 *
 * Everything here is arithmetic and grouping, with no database and no clock of
 * its own — the run date is passed in — so the parts most likely to be argued
 * about with a merchant are the parts covered by tests.
 *
 * Two things are easy to get subtly wrong and are handled explicitly:
 *
 *  - **Month arithmetic.** A subscription expiring on 31 August renewed for
 *    six months expires on 28 February, not 3 March. JavaScript's `Date` rolls
 *    over instead of clamping, which would hand the merchant extra days and
 *    make the invoice disagree with the licence.
 *
 *  - **Exclusive tax.** Tax is calculated on the subtotal and added to it. A
 *    plan price is never treated as already containing tax. While the rate is
 *    zero the line is suppressed on the document entirely, so registering for
 *    SST later is a settings change rather than a code change.
 *
 * Pure and runtime-free so it can be unit-tested under `node --test`.
 */

import { applyTaxExclusive, sumMinor } from "./money.ts"
import { TERM_MONTHS } from "./plan-resolution.ts"
import type { BillingTerm, PriceSource } from "./plan-resolution.ts"

/** Why an outlet was left out of a group it would otherwise have joined. */
export type ExclusionReason =
  | "billing_hold"
  | "reseller_billed"
  | "action_required"
  | "no_valid_until"

export type DueSubscription = {
  outletSubscriptionId: string
  franchiseId: string
  outletId: string
  centralId: string | null
  outletName: string | null
  companyName: string | null
  /** MySQL DATE, `YYYY-MM-DD`. */
  validUntilDate: string
  billedBy: "slurp" | "reseller"
  billingHold: boolean
}

export type PricedLine = {
  outletSubscriptionId: string
  franchiseId: string
  outletId: string
  centralId: string | null
  outletName: string | null
  planId: string | null
  assignmentId: string | null
  licensePlan: string | null
  billingPlan: BillingTerm
  catalogAmountMinor: number | null
  effectiveAmountMinor: number
  adjustmentAmountMinor: number
  priceSource: PriceSource
  previousValidUntilDate: string
}

export type InvoiceGroup = {
  /** `franchiseId|YYYY-MM-DD`. Deterministic, so a re-run recognises it. */
  groupKey: string
  franchiseId: string
  validUntilDate: string
  isGrouped: boolean
  members: DueSubscription[]
  excluded: Array<{ outletId: string; reason: ExclusionReason }>
}

export type InvoiceTotals = {
  subtotalMinor: number
  adjustmentMinor: number
  taxMinor: number
  totalMinor: number
}

export type InvoiceDraft = {
  groupKey: string
  franchiseId: string
  isGrouped: boolean
  billingPlan: BillingTerm
  termMonths: number
  /** The earliest expiry on the invoice: what the merchant is renewing from. */
  periodStart: string
  periodEnd: string
  dueDate: string
  lines: PricedLine[]
  totals: InvoiceTotals
}

/** `franchiseId|YYYY-MM-DD`. Deterministic and re-derivable by design. */
export function buildGroupKey(
  franchiseId: string,
  validUntilDate: string
): string {
  return `${franchiseId}|${validUntilDate}`
}

/**
 * Split due subscriptions into the invoices they should become.
 *
 * With grouping enabled for a franchise, every eligible outlet sharing a
 * `valid_until` date lands on one invoice with one line each. Outlets in the
 * same franchise on a different date form their own group. With grouping off,
 * every outlet gets its own invoice — which is still a group of one, so the
 * rest of the pipeline has exactly one shape to handle.
 *
 * Ineligible outlets are excluded from the group and recorded against it,
 * rather than dropped, so the total can be explained without re-running the
 * detector.
 */
export function groupDueSubscriptions(
  subscriptions: readonly DueSubscription[],
  groupingEnabledByFranchise: ReadonlySet<string>,
  blockedOutletKeys: ReadonlySet<string> = new Set()
): InvoiceGroup[] {
  const groups = new Map<string, InvoiceGroup>()

  for (const subscription of subscriptions) {
    const grouped = groupingEnabledByFranchise.has(subscription.franchiseId)

    // With grouping off, the outlet id joins the key so each outlet forms its
    // own group and the key stays unique.
    const groupKey = grouped
      ? buildGroupKey(subscription.franchiseId, subscription.validUntilDate)
      : `${buildGroupKey(subscription.franchiseId, subscription.validUntilDate)}|${subscription.outletId}`

    let group = groups.get(groupKey)
    if (!group) {
      group = {
        groupKey,
        franchiseId: subscription.franchiseId,
        validUntilDate: subscription.validUntilDate,
        isGrouped: grouped,
        members: [],
        excluded: [],
      }
      groups.set(groupKey, group)
    }

    const exclusion = exclusionFor(subscription, blockedOutletKeys)
    if (exclusion) {
      group.excluded.push({ outletId: subscription.outletId, reason: exclusion })
      continue
    }

    group.members.push(subscription)
  }

  // A group whose every member was excluded is not an invoice. Dropping it
  // here keeps "this group produced no invoice" out of the caller's business.
  return [...groups.values()].filter((group) => group.members.length > 0)
}

function exclusionFor(
  subscription: DueSubscription,
  blockedOutletKeys: ReadonlySet<string>
): ExclusionReason | null {
  if (subscription.billedBy === "reseller") {
    return "reseller_billed"
  }
  if (subscription.billingHold) {
    return "billing_hold"
  }
  if (!subscription.validUntilDate) {
    return "no_valid_until"
  }
  if (
    blockedOutletKeys.has(`${subscription.franchiseId}|${subscription.outletId}`)
  ) {
    return "action_required"
  }
  return null
}

/**
 * Price a group into a draft invoice.
 *
 * `lines` must already be priced by `resolvePriceForLine`; this composes them
 * into totals and dates. The split is deliberate — pricing one line is a
 * question about plans and overrides, and totalling an invoice is a question
 * about tax and periods.
 *
 * `periodStart` is the earliest expiry on the invoice, because that is the
 * date the merchant is renewing from, and `dueDate` is the same: the invoice
 * is due before the first licence in the group lapses.
 */
export function buildInvoiceDraft(input: {
  group: InvoiceGroup
  lines: readonly PricedLine[]
  billingPlan: BillingTerm
  taxRatePercent: string | number
}): InvoiceDraft {
  const { group, lines, billingPlan, taxRatePercent } = input

  if (lines.length === 0) {
    throw new Error(`Cannot build an invoice with no lines: ${group.groupKey}`)
  }

  const termMonths = TERM_MONTHS[billingPlan]
  const subtotalMinor = sumMinor(lines.map((line) => line.effectiveAmountMinor))
  const adjustmentMinor = sumMinor(lines.map((line) => line.adjustmentAmountMinor))
  const tax = applyTaxExclusive(subtotalMinor, taxRatePercent)

  const periodStart = earliest(lines.map((line) => line.previousValidUntilDate))

  return {
    groupKey: group.groupKey,
    franchiseId: group.franchiseId,
    // Reflects what the invoice actually bills, not whether the franchise has
    // grouping switched on. A franchise set to group whose outlets happen not
    // to share an expiry date produces single-outlet invoices, and calling
    // those "grouped" tells the reader something untrue.
    isGrouped: lines.length > 1,
    billingPlan,
    termMonths,
    periodStart,
    periodEnd: addMonths(periodStart, termMonths),
    dueDate: periodStart,
    lines: [...lines],
    totals: {
      subtotalMinor,
      adjustmentMinor,
      taxMinor: tax.taxMinor,
      totalMinor: tax.totalMinor,
    },
  }
}

/**
 * The expiry date a term produces, counted from the previous expiry.
 *
 * Always from the previous `valid_until`, never from the payment date, so a
 * merchant who pays late does not lose the intervening days.
 *
 * Month-end is clamped rather than rolled over: 31 August plus six months is
 * 28 February, not 3 March. `new Date(2026, 1, 31)` silently becomes 3 March,
 * which would hand the merchant days they did not buy and put SIMS out of step
 * with the licence.
 */
export function addMonths(date: string, months: number): string {
  const parsed = parseDateOnly(date)
  if (!parsed) {
    throw new Error(`Not a YYYY-MM-DD date: ${date}`)
  }

  const { year, month, day } = parsed
  const targetIndex = month - 1 + months
  const targetYear = year + Math.floor(targetIndex / 12)
  const targetMonth = ((targetIndex % 12) + 12) % 12

  const clampedDay = Math.min(day, daysInMonth(targetYear, targetMonth))

  return `${targetYear}-${pad(targetMonth + 1)}-${pad(clampedDay)}`
}

/** Days between two dates, positive when `to` is later. Whole days only. */
export function daysBetween(from: string, to: string): number {
  const a = parseDateOnly(from)
  const b = parseDateOnly(to)
  if (!a || !b) {
    throw new Error(`Not a YYYY-MM-DD date: ${from} / ${to}`)
  }
  const left = Date.UTC(a.year, a.month - 1, a.day)
  const right = Date.UTC(b.year, b.month - 1, b.day)
  return Math.round((right - left) / 86_400_000)
}

/**
 * The dates a run should look at, given its reminder offsets.
 *
 * Returns one date per offset: the expiry date that is exactly that many days
 * ahead. Matching on an exact date rather than a range is what stops a run
 * that was skipped for two days from suddenly invoicing three cohorts at once.
 */
export function offsetDates(
  today: string,
  offsets: readonly number[]
): Array<{ offset: number; date: string }> {
  return offsets.map((offset) => ({ offset, date: addDays(today, offset) }))
}

export function addDays(date: string, days: number): string {
  const parsed = parseDateOnly(date)
  if (!parsed) {
    throw new Error(`Not a YYYY-MM-DD date: ${date}`)
  }
  const shifted = new Date(
    Date.UTC(parsed.year, parsed.month - 1, parsed.day + days)
  )
  return `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(
    shifted.getUTCDate()
  )}`
}

function earliest(dates: readonly string[]): string {
  // MySQL DATE strings sort lexically, so this needs no parsing.
  let winner = dates[0]
  for (const date of dates) {
    if (date < winner) {
      winner = date
    }
  }
  return winner
}

function parseDateOnly(
  value: string
): { year: number; month: number; day: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value)
  if (!match) {
    return null
  }
  return {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
  }
}

/** `monthIndex` is 0-based, matching Date's own convention. */
function daysInMonth(year: number, monthIndex: number): number {
  return new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate()
}

function pad(value: number): string {
  return String(value).padStart(2, "0")
}
