import assert from "node:assert/strict"
import test from "node:test"

import {
  addDays,
  addMonths,
  buildGroupKey,
  buildInvoiceDraft,
  daysBetween,
  groupDueSubscriptions,
  offsetDates,
} from "./invoice-build.ts"
import type { DueSubscription, PricedLine } from "./invoice-build.ts"

function due(overrides: Partial<DueSubscription> = {}): DueSubscription {
  return {
    outletSubscriptionId: "1",
    franchiseId: "501",
    outletId: "3",
    centralId: null,
    outletName: "Outlet Three",
    companyName: "Kedai Kopi Sdn Bhd",
    validUntilDate: "2026-10-15",
    billedBy: "slurp",
    billingHold: false,
    ...overrides,
  }
}

function line(overrides: Partial<PricedLine> = {}): PricedLine {
  return {
    outletSubscriptionId: "1",
    franchiseId: "501",
    outletId: "3",
    centralId: null,
    outletName: "Outlet Three",
    planId: "1",
    assignmentId: "1",
    licensePlan: "essential",
    billingPlan: "annually",
    catalogAmountMinor: 120000,
    effectiveAmountMinor: 120000,
    adjustmentAmountMinor: 0,
    priceSource: "catalog",
    previousValidUntilDate: "2026-10-15",
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// Month arithmetic
// ---------------------------------------------------------------------------

test("adds a year", () => {
  assert.equal(addMonths("2026-10-15", 12), "2027-10-15")
})

test("adds six months", () => {
  assert.equal(addMonths("2026-10-15", 6), "2027-04-15")
})

test("clamps to the end of a shorter month instead of rolling over", () => {
  // The bug this guards: new Date(2027, 1, 31) silently becomes 3 March,
  // handing the merchant days they did not buy.
  assert.equal(addMonths("2026-08-31", 6), "2027-02-28")
  assert.equal(addMonths("2026-10-31", 1), "2026-11-30")
  assert.equal(addMonths("2026-01-31", 1), "2026-02-28")
})

test("lands on 29 February in a leap year", () => {
  assert.equal(addMonths("2027-08-29", 6), "2028-02-29")
  assert.equal(addMonths("2027-08-31", 6), "2028-02-29")
})

test("a leap day renewed for a year lands on 28 February", () => {
  assert.equal(addMonths("2028-02-29", 12), "2029-02-28")
})

test("crosses a year boundary", () => {
  assert.equal(addMonths("2026-12-15", 1), "2027-01-15")
  assert.equal(addMonths("2026-11-30", 12), "2027-11-30")
})

test("rejects anything that is not a plain date", () => {
  assert.throws(() => addMonths("15/10/2026", 12))
  assert.throws(() => addMonths("", 12))
})

test("counts whole days between dates", () => {
  assert.equal(daysBetween("2026-10-01", "2026-10-16"), 15)
  assert.equal(daysBetween("2026-10-16", "2026-10-01"), -15)
  assert.equal(daysBetween("2026-10-15", "2026-10-15"), 0)
  // Across a month and a leap day.
  assert.equal(daysBetween("2028-02-28", "2028-03-01"), 2)
})

test("shifts by days across month and year ends", () => {
  assert.equal(addDays("2026-10-15", 15), "2026-10-30")
  assert.equal(addDays("2026-12-31", 1), "2027-01-01")
  assert.equal(addDays("2026-03-01", -1), "2026-02-28")
})

test("derives one exact expiry date per reminder offset", () => {
  // Exact dates, not a range: a run skipped for two days must not suddenly
  // invoice three cohorts at once.
  assert.deepEqual(offsetDates("2026-10-01", [15, 5, 1]), [
    { offset: 15, date: "2026-10-16" },
    { offset: 5, date: "2026-10-06" },
    { offset: 1, date: "2026-10-02" },
  ])
})

// ---------------------------------------------------------------------------
// Grouping
// ---------------------------------------------------------------------------

test("a group key is franchise and expiry date", () => {
  assert.equal(buildGroupKey("501", "2026-10-15"), "501|2026-10-15")
})

test("grouping puts outlets sharing an expiry on one invoice", () => {
  // AC6: five outlets, one expiry date, one proforma.
  const subscriptions = ["3", "4", "5", "6", "7"].map((outletId) =>
    due({ outletId, outletSubscriptionId: outletId })
  )
  const groups = groupDueSubscriptions(subscriptions, new Set(["501"]))

  assert.equal(groups.length, 1)
  assert.equal(groups[0].groupKey, "501|2026-10-15")
  assert.equal(groups[0].isGrouped, true)
  assert.equal(groups[0].members.length, 5)
})

test("outlets on a different expiry date form their own group", () => {
  const subscriptions = [
    due({ outletId: "3" }),
    due({ outletId: "4" }),
    due({ outletId: "5" }),
    due({ outletId: "6", validUntilDate: "2026-11-20" }),
    due({ outletId: "7", validUntilDate: "2026-12-01" }),
  ]
  const groups = groupDueSubscriptions(subscriptions, new Set(["501"]))

  assert.equal(groups.length, 3)
  assert.deepEqual(
    groups.map((group) => group.members.length).sort(),
    [1, 1, 3]
  )
})

test("with grouping off every outlet gets its own invoice", () => {
  const subscriptions = ["3", "4", "5"].map((outletId) => due({ outletId }))
  const groups = groupDueSubscriptions(subscriptions, new Set())

  assert.equal(groups.length, 3)
  assert.ok(groups.every((group) => group.isGrouped === false))
  assert.ok(groups.every((group) => group.members.length === 1))
})

test("a held outlet is excluded from the group and recorded", () => {
  // The remaining outlets are invoiced normally and the total stays
  // explainable without re-running the detector.
  const subscriptions = [
    due({ outletId: "3" }),
    due({ outletId: "4", billingHold: true }),
    due({ outletId: "5" }),
  ]
  const groups = groupDueSubscriptions(subscriptions, new Set(["501"]))

  assert.equal(groups.length, 1)
  assert.equal(groups[0].members.length, 2)
  assert.deepEqual(groups[0].excluded, [
    { outletId: "4", reason: "billing_hold" },
  ])
})

test("a reseller-billed outlet is never invoiced by Slurp", () => {
  const subscriptions = [
    due({ outletId: "3" }),
    due({ outletId: "4", billedBy: "reseller" }),
  ]
  const groups = groupDueSubscriptions(subscriptions, new Set(["501"]))

  assert.equal(groups[0].members.length, 1)
  assert.deepEqual(groups[0].excluded, [
    { outletId: "4", reason: "reseller_billed" },
  ])
})

test("an outlet already in Actions Required is excluded", () => {
  const subscriptions = [due({ outletId: "3" }), due({ outletId: "4" })]
  const groups = groupDueSubscriptions(
    subscriptions,
    new Set(["501"]),
    new Set(["501|4"])
  )

  assert.equal(groups[0].members.length, 1)
  assert.deepEqual(groups[0].excluded, [
    { outletId: "4", reason: "action_required" },
  ])
})

test("a group whose every outlet is excluded produces no invoice", () => {
  const subscriptions = [
    due({ outletId: "3", billingHold: true }),
    due({ outletId: "4", billedBy: "reseller" }),
  ]
  assert.deepEqual(groupDueSubscriptions(subscriptions, new Set(["501"])), [])
})

test("different franchises never share a group", () => {
  const subscriptions = [
    due({ franchiseId: "501", outletId: "3" }),
    due({ franchiseId: "502", outletId: "3" }),
  ]
  const groups = groupDueSubscriptions(subscriptions, new Set(["501", "502"]))
  assert.equal(groups.length, 2)
})

// ---------------------------------------------------------------------------
// Draft totals
// ---------------------------------------------------------------------------

function groupOf(members: DueSubscription[]) {
  return groupDueSubscriptions(members, new Set(["501"]))[0]
}

test("totals a single-line invoice with no tax", () => {
  // AC7: at a zero rate the total equals the subtotal and no tax line exists.
  const draft = buildInvoiceDraft({
    group: groupOf([due()]),
    lines: [line()],
    billingPlan: "annually",
    taxRatePercent: "0.00",
  })

  assert.deepEqual(draft.totals, {
    subtotalMinor: 120000,
    adjustmentMinor: 0,
    taxMinor: 0,
    totalMinor: 120000,
  })
})

test("totals a grouped invoice across five outlets", () => {
  const members = ["3", "4", "5", "6", "7"].map((outletId) => due({ outletId }))
  const lines = members.map((member) => line({ outletId: member.outletId }))

  const draft = buildInvoiceDraft({
    group: groupOf(members),
    lines,
    billingPlan: "annually",
    taxRatePercent: "0.00",
  })

  assert.equal(draft.totals.subtotalMinor, 600000)
  assert.equal(draft.totals.totalMinor, 600000)
  assert.equal(draft.lines.length, 5)
  assert.equal(draft.isGrouped, true)
})

test("adds tax to the subtotal rather than extracting it", () => {
  const draft = buildInvoiceDraft({
    group: groupOf([due()]),
    lines: [line()],
    billingPlan: "annually",
    taxRatePercent: "8.00",
  })

  assert.equal(draft.totals.subtotalMinor, 120000)
  assert.equal(draft.totals.taxMinor, 9600)
  assert.equal(draft.totals.totalMinor, 129600)
})

test("carries the signed adjustment total, never netted away", () => {
  // A reduction on one line and an increase on another must both stay
  // recoverable; Analytics reports them separately.
  const members = [due({ outletId: "3" }), due({ outletId: "4" })]
  const lines = [
    line({ outletId: "3", effectiveAmountMinor: 100000, adjustmentAmountMinor: -20000 }),
    line({ outletId: "4", effectiveAmountMinor: 135000, adjustmentAmountMinor: 15000 }),
  ]

  const draft = buildInvoiceDraft({
    group: groupOf(members),
    lines,
    billingPlan: "annually",
    taxRatePercent: "0.00",
  })

  assert.equal(draft.totals.subtotalMinor, 235000)
  assert.equal(draft.totals.adjustmentMinor, -5000)
})

test("the period runs from the earliest expiry on the invoice", () => {
  // That is the date the merchant is renewing from, and the date the invoice
  // is due by.
  const members = [
    due({ outletId: "3", validUntilDate: "2026-10-15" }),
    due({ outletId: "4", validUntilDate: "2026-10-15" }),
  ]
  const lines = [
    line({ outletId: "3", previousValidUntilDate: "2026-10-15" }),
    line({ outletId: "4", previousValidUntilDate: "2026-10-15" }),
  ]

  const draft = buildInvoiceDraft({
    group: groupOf(members),
    lines,
    billingPlan: "annually",
    taxRatePercent: "0.00",
  })

  assert.equal(draft.periodStart, "2026-10-15")
  assert.equal(draft.periodEnd, "2027-10-15")
  assert.equal(draft.dueDate, "2026-10-15")
  assert.equal(draft.termMonths, 12)
})

test("switching to the six-month term reprices the period", () => {
  // AC8: period_end recalculates with the term.
  const draft = buildInvoiceDraft({
    group: groupOf([due()]),
    lines: [line({ effectiveAmountMinor: 70000, billingPlan: "bi_annually" })],
    billingPlan: "bi_annually",
    taxRatePercent: "0.00",
  })

  assert.equal(draft.termMonths, 6)
  assert.equal(draft.periodEnd, "2027-04-15")
  assert.equal(draft.totals.totalMinor, 70000)
})

test("refuses to build an invoice with no lines", () => {
  assert.throws(() =>
    buildInvoiceDraft({
      group: groupOf([due()]),
      lines: [],
      billingPlan: "annually",
      taxRatePercent: "0.00",
    })
  )
})

test("an invoice is only grouped when it actually bills more than one outlet", () => {
  // A franchise with grouping switched on, but only one outlet expiring on
  // this date. Calling that a grouped invoice tells the reader something
  // untrue.
  const single = buildInvoiceDraft({
    group: groupOf([due()]),
    lines: [line()],
    billingPlan: "annually",
    taxRatePercent: "0.00",
  })
  assert.equal(single.isGrouped, false)

  const members = [due({ outletId: "3" }), due({ outletId: "4" })]
  const many = buildInvoiceDraft({
    group: groupOf(members),
    lines: [line({ outletId: "3" }), line({ outletId: "4" })],
    billingPlan: "annually",
    taxRatePercent: "0.00",
  })
  assert.equal(many.isGrouped, true)
})
