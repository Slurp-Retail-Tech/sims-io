/**
 * Gathers the inputs for `metrics.ts` from the database.
 *
 * A period is a month (`YYYY-MM`) or a year (`YYYY`). The cohort is every
 * subscription expiring in the period; invoices are those whose expiry
 * cohort falls in the period, so a renewal outside it cannot inflate the
 * numerator. Every figure the page shows can be traced back to these rows.
 */

import getPool, { type Queryable } from "../db.ts"
import type { RowDataPacket } from "mysql2/promise"

import { listOpenActions } from "./actions-required.ts"
import { daysBetween } from "./invoice-build.ts"
import {
  engagementMetrics,
  monthlyBars,
  operationsMetrics,
  pricingMetrics,
  renewalMetrics,
} from "./metrics.ts"
import type {
  CohortOutlet,
  EngagementMetrics,
  InvoiceFact,
  LineFact,
  MonthBar,
  OperationsMetrics,
  PricingMetrics,
  RenewalMetrics,
} from "./metrics.ts"
import { loadRenewalList } from "./renewal-list-data.ts"
import { todayInAppZone } from "./app-date.ts"

export type AnalyticsPeriod = { key: string; from: string; to: string; label: string }

export type AnalyticsData = {
  period: AnalyticsPeriod
  periods: AnalyticsPeriod[]
  renewal: RenewalMetrics
  engagement: EngagementMetrics
  pricing: PricingMetrics
  operations: OperationsMetrics
  months: MonthBar[]
}

const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"]

function lastDayOfMonth(year: number, month: number): string {
  const day = new Date(Date.UTC(year, month, 0)).getUTCDate()
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`
}

export function resolvePeriod(key: string | null, today: string): { period: AnalyticsPeriod; periods: AnalyticsPeriod[] } {
  const [year, month] = today.split("-").map(Number)
  const periods: AnalyticsPeriod[] = []
  for (let offset = 0; offset < 6; offset += 1) {
    const date = new Date(Date.UTC(year, month - 1 - offset, 1))
    const y = date.getUTCFullYear()
    const m = date.getUTCMonth() + 1
    const monthKey = `${y}-${String(m).padStart(2, "0")}`
    periods.push({ key: monthKey, from: `${monthKey}-01`, to: lastDayOfMonth(y, m), label: `${MONTH_NAMES[m - 1]} ${y}` })
  }
  periods.push({ key: String(year), from: `${year}-01-01`, to: `${year}-12-31`, label: `Full year ${year}` })
  const period = periods.find((entry) => entry.key === key) ?? periods[0]
  return { period, periods }
}

type InvoiceRow = RowDataPacket & {
  id: string
  status: string
  is_grouped: number
  billing_plan_selected: "annually" | "bi_annually" | null
  total_amount: string
  adjustment_amount: string
  paid_at: string | null
  paid_via: string | null
  created_at: string
  first_opened_at: string | null
  open_count: number
  period_start: string | null
  has_session: number
}

export async function loadAnalytics(periodKey: string | null, db: Queryable = getPool()): Promise<AnalyticsData> {
  const today = todayInAppZone()
  const { period, periods } = resolvePeriod(periodKey, today)
  const year = Number(today.slice(0, 4))

  // The whole year of subscriptions, priced once; the period and the bars
  // are both cut from it.
  const horizon = daysBetween(today, `${year}-12-31`)
  const lookback = daysBetween(`${year}-01-01`, today)
  const [{ franchises }, invoiceRows, lineRows, actions, overrideRows] = await Promise.all([
    loadRenewalList({ horizonDays: Math.max(1, horizon), lookbackDays: Math.max(0, lookback), today }, db),
    db.query<InvoiceRow[]>(
      `SELECT i.id, i.status, i.is_grouped, i.billing_plan_selected, i.total_amount,
              i.adjustment_amount, i.paid_at, i.paid_via, i.created_at, i.first_opened_at,
              i.open_count, i.period_start,
              EXISTS (SELECT 1 FROM renewal_payment_sessions s
                       WHERE s.invoice_id = i.id AND s.cap_session_number IS NOT NULL) AS has_session
         FROM renewal_invoices i
        WHERE i.deleted_at IS NULL AND i.document_type = 'proforma'
          AND (i.period_start BETWEEN ? AND ? OR DATE(i.paid_at) BETWEEN ? AND ?)`,
      [`${year}-01-01`, `${year}-12-31`, `${year}-01-01`, `${year}-12-31`]
    ),
    db.query<RowDataPacket[]>(
      `SELECT t.price_source, t.adjustment_amount, t.cycle_override_amount, i.status, i.period_start
         FROM renewal_invoice_items t
         INNER JOIN renewal_invoices i ON i.id = t.invoice_id
        WHERE i.deleted_at IS NULL AND i.period_start BETWEEN ? AND ?`,
      [period.from, period.to]
    ),
    listOpenActions({}, db),
    db.query<RowDataPacket[]>(
      `SELECT COUNT(*) AS n FROM subscription_plan_assignments
        WHERE is_active = 1 AND deleted_at IS NULL
          AND (override_price_annually IS NOT NULL OR override_price_bi_annually IS NOT NULL)`
    ),
  ])

  const allOutlets: CohortOutlet[] = franchises.flatMap((franchise) =>
    franchise.outlets
      .filter((outlet) => outlet.validUntilDate)
      .map((outlet) => ({
        validUntilDate: outlet.validUntilDate as string,
        billedBy: outlet.billedBy,
        billingHold: outlet.billingHold,
        blocked: outlet.blockingReasons.length > 0,
        state: outlet.state,
        priceMinor: outlet.priceMinor,
      }))
  )
  const cohort = allOutlets.filter((outlet) => outlet.validUntilDate >= period.from && outlet.validUntilDate <= period.to)

  type CohortInvoice = InvoiceFact & { periodStart: string | null }
  const allInvoices: CohortInvoice[] = invoiceRows[0].map((row) => ({
    status: row.status,
    isGrouped: row.is_grouped === 1,
    billingPlanSelected: row.billing_plan_selected,
    totalMinor: Math.round(Number(row.total_amount) * 100),
    adjustmentMinor: Math.round(Number(row.adjustment_amount) * 100),
    paidAt: row.paid_at,
    paidVia: row.paid_via,
    createdAt: row.created_at,
    firstOpenedAt: row.first_opened_at,
    openCount: Number(row.open_count),
    hasSession: Number(row.has_session) === 1,
    reconciledBySweep: false,
    periodStart: row.period_start,
  }))
  const periodInvoices = allInvoices.filter(
    (invoice) => invoice.periodStart && invoice.periodStart >= period.from && invoice.periodStart <= period.to
  )

  const lines: LineFact[] = (lineRows[0] as Array<Record<string, string | null>>).map((row) => ({
    priceSource: String(row.price_source),
    adjustmentMinor: Math.round(Number(row.adjustment_amount) * 100),
    cycleOverrideMinor: row.cycle_override_amount === null ? null : Math.round(Number(row.cycle_override_amount) * 100),
    invoicePaid: row.status === "paid",
  }))

  const months = Array.from({ length: 12 }, (_, index) => `${year}-${String(index + 1).padStart(2, "0")}`)

  return {
    period,
    periods,
    renewal: renewalMetrics(cohort, periodInvoices),
    engagement: engagementMetrics(periodInvoices),
    pricing: pricingMetrics(lines, Number((overrideRows[0] as Array<{ n: number | string }>)[0]?.n ?? 0)),
    operations: operationsMetrics(
      actions.map((action) => ({
        severity: action.severity,
        ageDays: Math.max(0, daysBetween(action.firstDetectedAt.slice(0, 10), today)),
      })),
      periodInvoices
    ),
    months: monthlyBars(allOutlets, allInvoices, months),
  }
}
