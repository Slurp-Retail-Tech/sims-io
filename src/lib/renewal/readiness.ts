/**
 * Which subscriptions the nightly cycle looks at, and in what capacity.
 *
 * Two passes share one query:
 *
 *  - **Due.** Expiring on exactly one of the reminder offsets. These get the
 *    full treatment: eligibility checks, then an invoice or the reason there
 *    is none.
 *  - **Upcoming.** Expiring inside the readiness window but not on an offset.
 *    These get the same eligibility checks and nothing else. No invoice is
 *    raised; the point is that a missing plan or PIC shows up in Actions
 *    Required weeks early, while there is still time to fix it before the
 *    offset that would send the proforma.
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
 * A subscription on an offset date is due, full stop, even when the window is
 * shorter than the offset. Anything else inside `[today, today + windowDays]`
 * is upcoming. Anything outside both is dropped; it was only loaded because
 * the query's range has to cover the larger of the two horizons.
 */
export function partitionForCycle(
  subscriptions: readonly DueSubscription[],
  dueDates: ReadonlySet<string>,
  today: string,
  windowDays: number
): CyclePartition {
  const due: DueSubscription[] = []
  const upcoming: DueSubscription[] = []

  for (const subscription of subscriptions) {
    if (dueDates.has(subscription.validUntilDate)) {
      due.push(subscription)
      continue
    }
    const days = daysBetween(today, subscription.validUntilDate)
    if (days >= 0 && days <= windowDays) {
      upcoming.push(subscription)
    }
  }

  return { due, upcoming }
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
