/**
 * The renewal analytics, computed one way each.
 *
 * Every metric here has exactly one definition, so a figure on the page can
 * be traced to the rows that produced it and two screens cannot disagree.
 * Retention is computed inside a single cohort period (outlets expiring in
 * the period, renewed in the period), so it cannot exceed 100%.
 *
 * Pure and runtime-free so the arithmetic is unit-tested. The data layer
 * gathers the inputs; this file only counts and divides.
 */

export type CohortOutlet = {
  /** YYYY-MM-DD */
  validUntilDate: string
  billedBy: "slurp" | "reseller"
  billingHold: boolean
  blocked: boolean
  state: string
  /** Resolved price at the default term, or null when none resolves. */
  priceMinor: number | null
}

export type InvoiceFact = {
  status: string
  isGrouped: boolean
  billingPlanSelected: "annually" | "bi_annually" | null
  totalMinor: number
  adjustmentMinor: number
  paidAt: string | null
  paidVia: string | null
  createdAt: string
  firstOpenedAt: string | null
  openCount: number
  hasSession: boolean
  /** True when payment was confirmed by the query sweep rather than a callback. */
  reconciledBySweep: boolean
}

export type LineFact = {
  priceSource: string
  adjustmentMinor: number
  cycleOverrideMinor: number | null
  invoicePaid: boolean
}

export type ActionFact = {
  severity: "blocking" | "informational"
  /** Days the entry has been open. */
  ageDays: number
}

const LIVE = new Set(["issued", "sent", "payment_pending", "paid"])

export function percent(numerator: number, denominator: number): number | null {
  if (denominator === 0) {
    return null
  }
  return Math.round((numerator / denominator) * 1000) / 10
}

export function median(values: readonly number[]): number | null {
  if (values.length === 0) {
    return null
  }
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2
}

/** Hours between two UTC DATETIME strings. Null when either is missing. */
export function hoursBetween(from: string | null, to: string | null): number | null {
  if (!from || !to) {
    return null
  }
  const a = new Date(from.includes("T") ? from : `${from.replace(" ", "T")}Z`).getTime()
  const b = new Date(to.includes("T") ? to : `${to.replace(" ", "T")}Z`).getTime()
  if (Number.isNaN(a) || Number.isNaN(b)) {
    return null
  }
  return Math.round(((b - a) / 3_600_000) * 10) / 10
}

export type RenewalMetrics = {
  due: number
  renewable: number
  renewed: number
  nonRenewed: number
  potentialMinor: number
  collectedMinor: number
  collectionRate: number | null
  retentionRate: number | null
  termMix: { annually: number; biAnnually: number }
  groupedShare: number | null
}

export function renewalMetrics(cohort: readonly CohortOutlet[], invoices: readonly InvoiceFact[]): RenewalMetrics {
  const billable = cohort.filter((outlet) => outlet.billedBy === "slurp")
  const renewable = billable.filter((outlet) => !outlet.billingHold && !outlet.blocked)
  const renewed = renewable.filter((outlet) => outlet.state === "renewed")
  const nonRenewed = renewable.filter((outlet) => outlet.state === "non_renewed")
  const paid = invoices.filter((invoice) => invoice.status === "paid")
  const live = invoices.filter((invoice) => LIVE.has(invoice.status))
  const potentialMinor = renewable.reduce((sum, outlet) => sum + (outlet.priceMinor ?? 0), 0)
  const collectedMinor = paid.reduce((sum, invoice) => sum + invoice.totalMinor, 0)
  return {
    due: cohort.length,
    renewable: renewable.length,
    renewed: renewed.length,
    nonRenewed: nonRenewed.length,
    potentialMinor,
    collectedMinor,
    collectionRate: percent(collectedMinor, potentialMinor),
    retentionRate: percent(renewed.length, renewable.length),
    termMix: {
      annually: paid.filter((invoice) => invoice.billingPlanSelected === "annually").length,
      biAnnually: paid.filter((invoice) => invoice.billingPlanSelected === "bi_annually").length,
    },
    groupedShare: percent(live.filter((invoice) => invoice.isGrouped).length, live.length),
  }
}

export type EngagementMetrics = {
  invoicesRaised: number
  opened: number
  openRate: number | null
  neverOpened: number
  paidAfterOpen: number
  linkToPaymentRate: number | null
  medianHoursToFirstOpen: number | null
  sessionsStarted: number
}

export function engagementMetrics(invoices: readonly InvoiceFact[]): EngagementMetrics {
  const live = invoices.filter((invoice) => LIVE.has(invoice.status))
  const opened = live.filter((invoice) => invoice.openCount > 0)
  const paidAfterOpen = opened.filter((invoice) => invoice.status === "paid")
  const hours = live
    .map((invoice) => hoursBetween(invoice.createdAt, invoice.firstOpenedAt))
    .filter((value): value is number => value !== null && value >= 0)
  return {
    invoicesRaised: live.length,
    opened: opened.length,
    openRate: percent(opened.length, live.length),
    neverOpened: live.length - opened.length,
    paidAfterOpen: paidAfterOpen.length,
    linkToPaymentRate: percent(paidAfterOpen.length, opened.length),
    medianHoursToFirstOpen: median(hours),
    sessionsStarted: live.filter((invoice) => invoice.hasSession).length,
  }
}

export type PricingMetrics = {
  reductionsMinor: number
  increasesMinor: number
  assignmentOverrides: number
  cycleOverrides: number
  cycleOverrideMinor: number
}

/** Reductions and increases are reported separately and never netted. */
export function pricingMetrics(lines: readonly LineFact[], activeAssignmentOverrides: number): PricingMetrics {
  const paidLines = lines.filter((line) => line.invoicePaid)
  return {
    reductionsMinor: paidLines.filter((line) => line.adjustmentMinor < 0).reduce((sum, line) => sum + Math.abs(line.adjustmentMinor), 0),
    increasesMinor: paidLines.filter((line) => line.adjustmentMinor > 0).reduce((sum, line) => sum + line.adjustmentMinor, 0),
    assignmentOverrides: activeAssignmentOverrides,
    cycleOverrides: lines.filter((line) => line.cycleOverrideMinor !== null).length,
    cycleOverrideMinor: lines.filter((line) => line.cycleOverrideMinor !== null).reduce((sum, line) => sum + (line.cycleOverrideMinor ?? 0), 0),
  }
}

export type OperationsMetrics = {
  actionsOpen: number
  actionsBlocking: number
  averageDaysOpen: number | null
  medianDaysToPay: number | null
  paidOffline: number
  paidOfflineMinor: number
  reconciledBySweep: number
}

export function operationsMetrics(actions: readonly ActionFact[], invoices: readonly InvoiceFact[]): OperationsMetrics {
  const paid = invoices.filter((invoice) => invoice.status === "paid")
  const daysToPay = paid
    .map((invoice) => hoursBetween(invoice.createdAt, invoice.paidAt))
    .filter((value): value is number => value !== null && value >= 0)
    .map((hours) => Math.round((hours / 24) * 10) / 10)
  const offline = paid.filter((invoice) => invoice.paidVia === "manual")
  return {
    actionsOpen: actions.length,
    actionsBlocking: actions.filter((action) => action.severity === "blocking").length,
    averageDaysOpen: actions.length
      ? Math.round((actions.reduce((sum, action) => sum + action.ageDays, 0) / actions.length) * 10) / 10
      : null,
    medianDaysToPay: median(daysToPay),
    paidOffline: offline.length,
    paidOfflineMinor: offline.reduce((sum, invoice) => sum + invoice.totalMinor, 0),
    reconciledBySweep: paid.filter((invoice) => invoice.reconciledBySweep).length,
  }
}

export type MonthBar = { month: string; potentialMinor: number; collectedMinor: number }

/** Potential per expiry month against collected per paid month, for the bar chart. */
export function monthlyBars(
  outlets: readonly CohortOutlet[],
  invoices: readonly InvoiceFact[],
  months: readonly string[]
): MonthBar[] {
  return months.map((month) => ({
    month,
    potentialMinor: outlets
      .filter((outlet) => outlet.billedBy === "slurp" && !outlet.billingHold && outlet.validUntilDate.startsWith(month))
      .reduce((sum, outlet) => sum + (outlet.priceMinor ?? 0), 0),
    collectedMinor: invoices
      .filter((invoice) => invoice.status === "paid" && (invoice.paidAt ?? "").startsWith(month))
      .reduce((sum, invoice) => sum + invoice.totalMinor, 0),
  }))
}
