/**
 * Which subscriptions the nightly cycle looks at, and in what capacity.
 *
 * Two passes share one query:
 *
 *  - **Due.** Expiring inside the invoicing window, which runs from the
 *    furthest reminder offset down to the expiry date itself. These get the
 *    full treatment: eligibility checks, then an invoice or the reason there
 *    is none.
 *  - **Upcoming.** Expiring beyond the invoicing window but inside the
 *    readiness window. These get the same eligibility checks and nothing
 *    else. No invoice is raised; the point is that a missing plan or PIC
 *    shows up in Actions Required weeks early, while there is still time to
 *    fix it before the offset that would send the proforma.
 *
 * *** WHY A WINDOW AND NOT THE OFFSET DATES ***
 *
 * The due pass used to match each reminder offset as an exact date, so an
 * outlet was only ever invoiced on the night it sat exactly 15, 5 or 1 days
 * out. An expiry date that moved -- the POS sync correcting it, a renewal
 * done outside SIMS, a hand edit -- could step over all three dates and
 * never be invoiced at all, and the outlet then lapsed with nothing raised
 * and nothing in the queue to say why.
 *
 * The window closes that hole: any eligible outlet inside it that has no
 * open proforma gets one, whichever night it is. Raising a second invoice is
 * not a risk, because generation is idempotent -- `findOpenProformaForOutlets`
 * and the `open_guard` index both refuse a duplicate -- so a night that finds
 * an invoice already there reuses it, exactly as the later offsets always did.
 *
 * The offsets keep their other job: they are still the reminder cadence, and
 * only a night that lands on one records the cadence event.
 *
 * Already-expired outlets stay out of the due pass. A licence that lapsed
 * without an invoice is a question for a person, not something to bill for
 * retroactively on the next run.
 *
 * Pure and runtime-free so the partition can be unit-tested.
 */

import type { ActionReason } from "./actions-required.ts"
import { daysBetween } from "./invoice-build.ts"
import type { DueSubscription } from "./invoice-build.ts"

/**
 * The reasons the cycle itself evaluates on every pass.
 *
 * Only these are auto-resolved when a pass no longer reports them. A reason
 * raised by some other process -- a failed dispatch, a POS push that did not
 * land -- is not something the cycle has an opinion about, so it must never
 * close one merely because it looked at the same outlet.
 */
export const CYCLE_EVALUATED_REASONS = [
  "no_plan_assigned",
  "plan_missing_term_price",
  "override_pending_approval",
  "override_rejected",
  "no_renewal_pic",
  "ambiguous_renewal_pic",
  "unreachable_renewal_pic",
  "channel_unreachable",
] as const satisfies readonly ActionReason[]

export type CyclePartition = {
  due: DueSubscription[]
  upcoming: DueSubscription[]
}

/**
 * Split the loaded subscriptions into the due cohort and the readiness cohort.
 *
 * Due is `[today, today + invoiceWindowDays]`, so it covers every offset and
 * every day between them. Upcoming is what is left inside
 * `[today, today + windowDays]`. Anything outside both is dropped; it was
 * only loaded because the query's range has to cover the larger of the two
 * horizons.
 *
 * A window shorter than the furthest offset does not shrink the due cohort:
 * the invoicing window governs invoicing, the readiness window only governs
 * how far ahead the early warning looks.
 */
export function partitionForCycle(
  subscriptions: readonly DueSubscription[],
  invoiceWindowDays: number,
  today: string,
  windowDays: number
): CyclePartition {
  const due: DueSubscription[] = []
  const upcoming: DueSubscription[] = []

  for (const subscription of subscriptions) {
    const days = daysBetween(today, subscription.validUntilDate)
    if (days < 0) {
      // Already expired. Never invoiced retroactively; see the header note.
      continue
    }
    if (days <= invoiceWindowDays) {
      due.push(subscription)
      continue
    }
    if (days <= windowDays) {
      upcoming.push(subscription)
    }
  }

  return { due, upcoming }
}

/**
 * How many days ahead of expiry the cycle will raise an invoice.
 *
 * The furthest configured reminder offset: the first reminder is the point
 * at which a merchant is meant to have a document, so it is also the point
 * from which one may exist.
 */
export function invoiceWindowDays(offsets: readonly number[]): number {
  return offsets.reduce((max, offset) => Math.max(max, offset), 0)
}

/**
 * How far ahead the cycle has to read so both passes are covered.
 *
 * The larger of the readiness window and the furthest offset. Never less than
 * zero, so a hand-edited setting cannot turn the range inside out.
 */
export function cycleHorizonDays(
  offsets: readonly number[],
  windowDays: number
): number {
  const furthestOffset = offsets.reduce((max, offset) => Math.max(max, offset), 0)
  return Math.max(0, windowDays, furthestOffset)
}

/** The scope key Actions Required entries are examined and resolved by. */
export function scopeKey(franchiseId: string, outletId: string | null): string {
  return `${franchiseId}|${outletId ?? "*"}`
}

/**
 * Which cohort each pass gets, by mode.
 *
 * A full run invoices the due cohort and readiness-checks the rest. A check
 * ("Check now") never invoices, so the due cohort joins the readiness sweep:
 * the same plan, price and PIC checks, with no invoice at the end.
 */
export function cohortsForMode<T>(
  mode: "full" | "check",
  partition: { due: readonly T[]; upcoming: readonly T[] }
): { invoice: T[]; checkOnly: T[] } {
  return mode === "full"
    ? { invoice: [...partition.due], checkOnly: [...partition.upcoming] }
    : { invoice: [], checkOnly: [...partition.due, ...partition.upcoming] }
}

/**
 * The reasons a pass may auto-resolve, by mode.
 *
 * `channel_unreachable` is only raised while an invoice is being addressed,
 * so a check, which addresses none, has no opinion on it and must not close
 * it merely for not having re-raised it.
 */
export function reasonsEvaluatedFor(mode: "full" | "check"): readonly ActionReason[] {
  return mode === "full"
    ? CYCLE_EVALUATED_REASONS
    : CYCLE_EVALUATED_REASONS.filter((reason) => reason !== "channel_unreachable")
}
