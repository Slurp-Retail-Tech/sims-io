/**
 * The Renewal List: every subscription due, grouped by franchise, with the
 * state each one is in and why.
 *
 * The state is derived, not stored. `outlet_subscriptions.renewal_state`
 * exists for the future dispatch pipeline to write, but today the truth is
 * spread across the invoice, the payment session, the Actions Required queue
 * and the expiry date, and deriving it from those every time means the list
 * cannot disagree with them.
 *
 * Pure and runtime-free so the derivation and the filters are unit-tested.
 */

import { daysBetween } from "./invoice-build.ts"

export type RenewalState =
  | "not_due"
  | "invoiced"
  | "reminder_sent"
  | "awaiting_payment"
  | "renewed"
  | "non_renewed"
  | "on_hold"
  | "action_required"
  | "reseller"

export const STATE_LABELS: Record<RenewalState, string> = {
  not_due: "Not due",
  invoiced: "Invoice raised",
  reminder_sent: "Reminder sent",
  awaiting_payment: "Awaiting payment",
  renewed: "Renewed",
  non_renewed: "Non-renewed",
  on_hold: "On hold",
  action_required: "Action required",
  reseller: "Reseller-billed",
}

/** Urgency order for rolling outlet states up to a franchise. Higher wins. */
const STATE_RANK: Record<RenewalState, number> = {
  action_required: 8,
  non_renewed: 7,
  awaiting_payment: 6,
  reminder_sent: 5,
  invoiced: 4,
  renewed: 3,
  on_hold: 2,
  not_due: 1,
  reseller: 0,
}

export type OutletFacts = {
  validUntilDate: string | null
  billedBy: "slurp" | "reseller"
  billingHold: boolean
  hasBlockingAction: boolean
  invoiceStatus: string | null
  /** True once a reminder dispatch row exists for the invoice. */
  reminderSent: boolean
  /** Payment confirmed (invoice paid) and the extension landed. */
  extended: boolean
}

export function deriveOutletState(facts: OutletFacts, today: string): RenewalState {
  if (facts.billedBy === "reseller") {
    return "reseller"
  }
  if (facts.billingHold) {
    return "on_hold"
  }
  if (facts.invoiceStatus === "paid" && facts.extended) {
    return "renewed"
  }
  if (facts.hasBlockingAction) {
    return "action_required"
  }
  if (facts.invoiceStatus === "paid") {
    // Paid, extension still in flight (or failed without a queue entry yet).
    return "renewed"
  }
  if (facts.validUntilDate && daysBetween(today, facts.validUntilDate) < 0) {
    return "non_renewed"
  }
  if (facts.invoiceStatus === "payment_pending") {
    return "awaiting_payment"
  }
  if (facts.invoiceStatus && !["cancelled", "superseded", "lapsed", "draft"].includes(facts.invoiceStatus)) {
    return facts.reminderSent ? "reminder_sent" : "invoiced"
  }
  return "not_due"
}

/** The franchise carries its most urgent outlet's state; all-renewed reads renewed. */
export function rollUpState(states: readonly RenewalState[]): RenewalState {
  if (states.length === 0) {
    return "not_due"
  }
  const live = states.filter((state) => state !== "reseller")
  if (live.length === 0) {
    return "reseller"
  }
  if (live.every((state) => state === "renewed")) {
    return "renewed"
  }
  return live.reduce((worst, state) => (STATE_RANK[state] > STATE_RANK[worst] ? state : worst), live[0])
}

/** "Meal Standard ×2, Essential Standard ×4", or a reason nothing resolves. */
export function summarisePlans(planNames: ReadonlyArray<string | null>): string {
  const counts = new Map<string, number>()
  let unresolved = 0
  for (const name of planNames) {
    if (!name) {
      unresolved += 1
      continue
    }
    counts.set(name, (counts.get(name) ?? 0) + 1)
  }
  const parts = [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([name, count]) => (count === 1 ? name : `${name} ×${count}`))
  if (unresolved > 0) {
    parts.push(counts.size === 0 ? "No plan resolves" : `${unresolved} without a plan`)
  }
  return parts.join(", ")
}

export type ListFilters = {
  search: string
  state: RenewalState | "all"
  /** `YYYY-MM` or "all". */
  month: string
  opened: "all" | "opened" | "never"
}

export type FilterableFranchise = {
  franchiseId: string
  name: string | null
  fid: string | null
  state: RenewalState
  validUntilDate: string | null
  outlets: ReadonlyArray<{ name: string | null; outletId: string; openCount: number; hasInvoice: boolean }>
}

export function matchesFilters(franchise: FilterableFranchise, filters: ListFilters): boolean {
  const query = filters.search.trim().toLowerCase()
  if (query) {
    const haystack = [
      franchise.name ?? "",
      franchise.franchiseId,
      franchise.fid ?? "",
      ...franchise.outlets.map((outlet) => `${outlet.name ?? ""} ${outlet.outletId}`),
    ]
      .join(" ")
      .toLowerCase()
    if (!haystack.includes(query)) {
      return false
    }
  }
  if (filters.state !== "all" && franchise.state !== filters.state) {
    return false
  }
  if (filters.month !== "all" && !(franchise.validUntilDate ?? "").startsWith(filters.month)) {
    return false
  }
  if (filters.opened === "opened" && !franchise.outlets.some((outlet) => outlet.openCount > 0)) {
    return false
  }
  if (
    filters.opened === "never" &&
    !franchise.outlets.some((outlet) => outlet.hasInvoice && outlet.openCount === 0)
  ) {
    return false
  }
  return true
}

/** The expiry months present, for the month filter: `YYYY-MM` ascending. */
export function expiryMonths(dates: ReadonlyArray<string | null>): string[] {
  return [...new Set(dates.filter((date): date is string => Boolean(date)).map((date) => date.slice(0, 7)))].sort()
}
