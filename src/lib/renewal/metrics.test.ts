import assert from "node:assert/strict"
import test from "node:test"

import {
  engagementMetrics,
  hoursBetween,
  median,
  monthlyBars,
  nonRenewalMetrics,
  operationsMetrics,
  percent,
  pricingMetrics,
  renewalMetrics,
} from "./metrics.ts"
import type { CohortOutlet, InvoiceFact } from "./metrics.ts"

function outlet(overrides: Partial<CohortOutlet> = {}): CohortOutlet {
  return {
    validUntilDate: "2026-09-30",
    billedBy: "slurp",
    billingHold: false,
    blocked: false,
    state: "invoiced",
    priceMinor: 120000,
    ...overrides,
  }
}

function invoice(overrides: Partial<InvoiceFact> = {}): InvoiceFact {
  return {
    status: "paid",
    isGrouped: false,
    billingPlanSelected: "annually",
    totalMinor: 120000,
    adjustmentMinor: 0,
    paidAt: "2026-09-12 04:00:00.000",
    paidVia: "commercepay",
    createdAt: "2026-09-02 06:00:00.000",
    firstOpenedAt: "2026-09-03 13:14:00.000",
    openCount: 2,
    hasSession: true,
    reconciledBySweep: false,
    ...overrides,
  }
}

test("percent and median handle empty inputs without dividing by zero", () => {
  assert.equal(percent(1, 0), null)
  assert.equal(percent(1, 4), 25)
  assert.equal(median([]), null)
  assert.equal(median([3, 1, 2]), 2)
  assert.equal(median([1, 2, 3, 4]), 2.5)
})

test("retention is computed inside the cohort and cannot exceed 100%", () => {
  const cohort = [
    outlet({ state: "renewed" }),
    outlet({ state: "renewed" }),
    outlet({ state: "non_renewed" }),
    outlet({ state: "invoiced", blocked: true }), // excluded from renewable
    outlet({ billedBy: "reseller", state: "renewed" }), // never counted
  ]
  const metrics = renewalMetrics(cohort, [])
  assert.equal(metrics.due, 5)
  assert.equal(metrics.renewable, 3)
  assert.equal(metrics.renewed, 2)
  assert.equal(metrics.nonRenewed, 1)
  assert.equal(metrics.retentionRate, 66.7)
  assert.equal(metrics.potentialMinor, 360000)
})

test("collection rate is paid tax invoices against renewable potential", () => {
  const metrics = renewalMetrics([outlet(), outlet()], [invoice({ totalMinor: 120000 })])
  assert.equal(metrics.collectedMinor, 120000)
  assert.equal(metrics.collectionRate, 50)
})

test("term mix and grouped share come from invoices", () => {
  const metrics = renewalMetrics(
    [],
    [
      invoice({ billingPlanSelected: "annually", isGrouped: true }),
      invoice({ billingPlanSelected: "bi_annually" }),
      invoice({ status: "sent", billingPlanSelected: "annually" }),
      invoice({ status: "cancelled", isGrouped: true }), // not live
    ]
  )
  assert.deepEqual(metrics.termMix, { annually: 1, biAnnually: 1 })
  assert.equal(metrics.groupedShare, 33.3)
})

test("engagement counts opens against live invoices only", () => {
  const metrics = engagementMetrics([
    invoice({ status: "sent", openCount: 0, firstOpenedAt: null }),
    invoice({ status: "sent", openCount: 3 }),
    invoice({ status: "paid", openCount: 1 }),
    invoice({ status: "cancelled", openCount: 5 }),
  ])
  assert.equal(metrics.invoicesRaised, 3)
  assert.equal(metrics.opened, 2)
  assert.equal(metrics.openRate, 66.7)
  assert.equal(metrics.neverOpened, 1)
  assert.equal(metrics.paidAfterOpen, 1)
  assert.equal(metrics.linkToPaymentRate, 50)
  assert.equal(metrics.medianHoursToFirstOpen, 31.2)
})

test("hours between two UTC timestamps, null when either is missing", () => {
  assert.equal(hoursBetween("2026-09-02 06:00:00.000", "2026-09-02 09:30:00.000"), 3.5)
  assert.equal(hoursBetween(null, "2026-09-02 09:30:00.000"), null)
})

test("reductions and increases are reported separately, never netted", () => {
  const metrics = pricingMetrics(
    [
      { priceSource: "assignment_override", adjustmentMinor: -24000, cycleOverrideMinor: null, invoicePaid: true },
      { priceSource: "assignment_override", adjustmentMinor: 18000, cycleOverrideMinor: null, invoicePaid: true },
      { priceSource: "cycle_override", adjustmentMinor: -5000, cycleOverrideMinor: 115000, invoicePaid: false },
    ],
    14
  )
  assert.equal(metrics.reductionsMinor, 24000)
  assert.equal(metrics.increasesMinor, 18000)
  assert.equal(metrics.assignmentOverrides, 14)
  assert.equal(metrics.cycleOverrides, 1)
  assert.equal(metrics.cycleOverrideMinor, 115000)
})

test("operations: queue age, days to pay, offline payments and sweep recoveries", () => {
  const metrics = operationsMetrics(
    [
      { severity: "blocking", ageDays: 4 },
      { severity: "informational", ageDays: 10 },
    ],
    [
      invoice(), // 10 days from creation to payment
      invoice({ paidVia: "manual", totalMinor: 70000, reconciledBySweep: true }),
    ]
  )
  assert.equal(metrics.actionsOpen, 2)
  assert.equal(metrics.actionsBlocking, 1)
  assert.equal(metrics.averageDaysOpen, 7)
  assert.equal(metrics.medianDaysToPay, 9.9)
  assert.equal(metrics.paidOffline, 1)
  assert.equal(metrics.paidOfflineMinor, 70000)
  assert.equal(metrics.reconciledBySweep, 1)
})

test("monthly bars pair potential by expiry month with collected by paid month", () => {
  const bars = monthlyBars(
    [outlet({ validUntilDate: "2026-09-30" }), outlet({ validUntilDate: "2026-10-15", priceMinor: 70000 })],
    [invoice({ paidAt: "2026-09-12 00:00:00.000", totalMinor: 120000 })],
    ["2026-09", "2026-10"]
  )
  assert.deepEqual(bars, [
    { month: "2026-09", potentialMinor: 120000, collectedMinor: 120000 },
    { month: "2026-10", potentialMinor: 70000, collectedMinor: 0 },
  ])
})

test("non-renewals are counted by recorded reason, with the unrecorded remainder", () => {
  const metrics = nonRenewalMetrics([
    outlet({ state: "non_renewed", nonRenewalReason: "switched_system" }),
    outlet({ state: "non_renewed", nonRenewalReason: "switched_system" }),
    outlet({ state: "non_renewed", nonRenewalReason: "temp_close" }),
    outlet({ state: "non_renewed" }),
    // Not renewable, so not counted, just as renewalMetrics leaves them out.
    outlet({ state: "non_renewed", billedBy: "reseller", nonRenewalReason: "closed_business" }),
    outlet({ state: "renewed" }),
  ])
  assert.equal(metrics.nonRenewed, 4)
  assert.equal(metrics.recorded, 3)
  assert.equal(metrics.unrecorded, 1)
  assert.deepEqual(metrics.byReason.slice(0, 2).map((entry) => [entry.reason, entry.count, entry.share]), [
    ["switched_system", 2, 66.7],
    ["temp_close", 1, 33.3],
  ])
  assert.equal(metrics.temporaryShare, 33.3)
  // Every reason is listed, so the chart's categories never shift between periods.
  assert.equal(metrics.byReason.length, 6)
})

test("with nothing recorded, shares are empty rather than zero", () => {
  const metrics = nonRenewalMetrics([outlet({ state: "non_renewed" })])
  assert.equal(metrics.recorded, 0)
  assert.equal(metrics.temporaryShare, null)
  assert.ok(metrics.byReason.every((entry) => entry.share === null))
})

test("the reason total agrees with renewalMetrics' non-renewed count", () => {
  const cohort = [outlet({ state: "non_renewed", blocked: true }), outlet({ state: "non_renewed", nonRenewalReason: "other" })]
  assert.equal(nonRenewalMetrics(cohort).nonRenewed, renewalMetrics(cohort, []).nonRenewed)
})
