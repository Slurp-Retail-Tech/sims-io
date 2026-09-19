/**
 * Switching an invoice between terms.
 *
 * The merchant's page offers a term switcher. Choosing a term reprices every
 * line through the same resolution the nightly cycle used, so the number on
 * the page is the number the cycle would have produced had the assignment's
 * default been that term. Nothing here invents a price.
 *
 * Rules:
 *  - A term is offered only if EVERY line can be priced on it. A plan with no
 *    six-month price removes six months from the whole invoice, because a
 *    document cannot be half on one term.
 *  - A line carrying a one-off cycle override pins the invoice to its current
 *    term. Somebody set that price for that document; silently repricing it
 *    on another term would discard their decision.
 *  - A repriced line that would need approval blocks the switch. The variance
 *    threshold does not stop applying because the merchant is the one asking.
 *
 * Pure and runtime-free so it can be unit-tested under `node --test`.
 */

import { addMonths } from "./invoice-build.ts"
import type { InvoiceTotals } from "./invoice-build.ts"
import { applyTaxExclusive, sumMinor } from "./money.ts"
import {
  availableTerms,
  resolvePriceForLine,
  TERM_MONTHS,
} from "./plan-resolution.ts"
import type {
  AssignmentRecord,
  BillingTerm,
  PlanRecord,
  PriceSource,
} from "./plan-resolution.ts"

/** One invoice line with everything needed to reprice it. */
export type LineContext = {
  itemId: string
  outletId: string
  plan: PlanRecord | null
  assignment: AssignmentRecord | null
  cycleOverrideMinor: number | null
  /** YYYY-MM-DD; what this outlet renews from. */
  previousValidUntilDate: string | null
}

export type RepricedLine = {
  itemId: string
  outletId: string
  billingPlan: BillingTerm
  catalogMinor: number
  effectiveMinor: number
  adjustmentMinor: number
  priceSource: PriceSource
  newValidUntilDate: string | null
}

export type RepriceResult =
  | {
      ok: true
      term: BillingTerm
      termMonths: number
      lines: RepricedLine[]
      totals: InvoiceTotals
      /** Earliest previous expiry across lines, or null when none is known. */
      periodStart: string | null
      periodEnd: string | null
    }
  | { ok: false; reason: "term_unavailable" | "requires_approval" | "no_plan"; outletId: string | null }

/**
 * The terms every line can be priced on, or only the current term when a
 * line is pinned by a cycle override.
 */
export function availableTermsForInvoice(
  lines: readonly LineContext[],
  currentTerm: BillingTerm
): BillingTerm[] {
  if (lines.length === 0) {
    return [currentTerm]
  }
  if (lines.some((line) => line.cycleOverrideMinor !== null)) {
    return [currentTerm]
  }

  let terms: BillingTerm[] | null = null
  for (const line of lines) {
    if (!line.plan) {
      return [currentTerm]
    }
    const forLine = availableTerms(line.plan, line.assignment)
    terms = terms === null ? forLine : terms.filter((term) => forLine.includes(term))
  }
  const result = terms ?? []
  // The current term is always offered: it is what the invoice already says.
  return result.includes(currentTerm) ? result : [currentTerm, ...result]
}

/** Reprice every line on `term`. */
export function repriceInvoiceForTerm(input: {
  lines: readonly LineContext[]
  term: BillingTerm
  taxRatePercent: number
  thresholdPercent: number
}): RepriceResult {
  const { lines, term, taxRatePercent, thresholdPercent } = input
  const repriced: RepricedLine[] = []

  for (const line of lines) {
    if (!line.plan) {
      return { ok: false, reason: "no_plan", outletId: line.outletId }
    }
    const price = resolvePriceForLine({
      plan: line.plan,
      assignment: line.assignment,
      term,
      cycleOverrideMinor: line.cycleOverrideMinor,
      thresholdPercent,
    })
    if (price.status === "plan_missing_term_price") {
      return { ok: false, reason: "term_unavailable", outletId: line.outletId }
    }
    if (price.requiresApproval) {
      return { ok: false, reason: "requires_approval", outletId: line.outletId }
    }
    repriced.push({
      itemId: line.itemId,
      outletId: line.outletId,
      billingPlan: term,
      catalogMinor: price.catalogMinor,
      effectiveMinor: price.effectiveMinor,
      adjustmentMinor: price.adjustmentMinor,
      priceSource: price.source,
      newValidUntilDate: line.previousValidUntilDate
        ? addMonths(line.previousValidUntilDate, TERM_MONTHS[term])
        : null,
    })
  }

  const subtotalMinor = sumMinor(repriced.map((line) => line.effectiveMinor))
  const adjustmentMinor = sumMinor(repriced.map((line) => line.adjustmentMinor))
  const tax = applyTaxExclusive(subtotalMinor, taxRatePercent)

  const starts = lines
    .map((line) => line.previousValidUntilDate)
    .filter((date): date is string => Boolean(date))
    .sort()
  const periodStart = starts[0] ?? null

  return {
    ok: true,
    term,
    termMonths: TERM_MONTHS[term],
    lines: repriced,
    totals: {
      subtotalMinor,
      adjustmentMinor,
      taxMinor: tax.taxMinor,
      totalMinor: tax.totalMinor,
    },
    periodStart,
    periodEnd: periodStart ? addMonths(periodStart, TERM_MONTHS[term]) : null,
  }
}
