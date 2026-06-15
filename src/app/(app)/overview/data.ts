import "server-only"

import { getSalesOverviewData } from "@/app/(app)/sales/overview/data"
import { activeSupportRequestWhere } from "@/lib/analytics-ticket-filters"
import { localSqlDate, localSqlToday } from "@/lib/app-timezone"
import { queryWithReconnect } from "@/lib/db"

type ActiveStatusRow = {
  open_total: number | string
  in_progress_total: number | string
  pending_customer_total: number | string
}

type CountRow = {
  total: number | string
}

type MerchantStatusRow = {
  total: number | string
  live_total: number | string
  test_total: number | string
  closed_total: number | string
}

type SatisfactionRow = {
  support_avg: number | string | null
  product_avg: number | string | null
}

export type MerchantSuccessOverview = {
  activeTickets: number
  activeOpen: number
  activeInProgress: number
  activePendingCustomer: number
  newToday: number
  resolvedToday: number
  available: boolean
}

export type SalesOverviewSummary = {
  leadsThisMonth: number
  appointmentsThisMonth: number
  completionRate: number | null
  available: boolean
}

export type MerchantsOverview = {
  total: number
  live: number
  test: number
  closed: number
  outlets: number
  available: boolean
}

export type CsatOverview = {
  supportAverage: number | null
  productAverage: number | null
  available: boolean
}

export type GeneralOverviewData = {
  merchantSuccess: MerchantSuccessOverview
  sales: SalesOverviewSummary
  merchants: MerchantsOverview
  csat: CsatOverview
}

// Reuse the exact raw_payload status expressions from the merchants API route so
// the live/test/closed split here matches the directory page.
const CLOSED_FLAG_SQL =
  "COALESCE(CAST(JSON_UNQUOTE(JSON_EXTRACT(raw_payload, '$.closed_account')) AS CHAR), 'false') IN ('true', '1')"
const TEST_FLAG_SQL =
  "COALESCE(CAST(JSON_UNQUOTE(JSON_EXTRACT(raw_payload, '$.test_account')) AS CHAR), 'false') IN ('true', '1')"

// Mirror the text -> 1-4 score mapping from CSAT Insights so averages match.
function scoreCaseSql(column: string) {
  return `
    CASE
      WHEN LOWER(TRIM(${column})) IN ('very satisfied', 'sangat puas hati') THEN 4
      WHEN LOWER(TRIM(${column})) IN ('satisfied', 'puas hati') THEN 3
      WHEN LOWER(TRIM(${column})) IN ('neutral', 'berkecuali') THEN 2
      WHEN LOWER(TRIM(${column})) IN ('dissatisfied', 'tidak berpuas hati') THEN 1
      WHEN TRIM(${column}) REGEXP '^[1-5]$' THEN CAST(TRIM(${column}) AS UNSIGNED)
      ELSE NULL
    END
  `
}

function toNumber(value: number | string | null | undefined): number {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : 0
  }
  if (typeof value === "string") {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : 0
  }
  return 0
}

function toAverage(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined) {
    return null
  }
  const parsed = typeof value === "number" ? value : Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

async function getMerchantSuccessOverview(): Promise<MerchantSuccessOverview> {
  try {
    const ticketEventDate = localSqlDate("COALESCE(attended_at, created_at)")
    const ticketResolvedDate = localSqlDate("COALESCE(closed_at, updated_at)")
    const today = localSqlToday()

    const [[activeStatusRows], [newTodayRows], [resolvedTodayRows]] = await Promise.all([
      queryWithReconnect<ActiveStatusRow[]>(
        `
        SELECT
          SUM(CASE WHEN status = 'Open' THEN 1 ELSE 0 END) AS open_total,
          SUM(CASE WHEN status = 'In Progress' THEN 1 ELSE 0 END) AS in_progress_total,
          SUM(CASE WHEN status = 'Pending Customer' THEN 1 ELSE 0 END) AS pending_customer_total
        FROM tickets
        WHERE ${activeSupportRequestWhere()}
      `
      ),
      queryWithReconnect<CountRow[]>(
        `
        SELECT COUNT(*) AS total
        FROM tickets
        WHERE ${activeSupportRequestWhere()}
          AND ${ticketEventDate} = ${today}
      `
      ),
      queryWithReconnect<CountRow[]>(
        `
        SELECT COUNT(*) AS total
        FROM tickets
        WHERE ${activeSupportRequestWhere()}
          AND status = 'Resolved'
          AND ${ticketResolvedDate} = ${today}
      `
      ),
    ])

    const activeOpen = toNumber(activeStatusRows[0]?.open_total)
    const activeInProgress = toNumber(activeStatusRows[0]?.in_progress_total)
    const activePendingCustomer = toNumber(activeStatusRows[0]?.pending_customer_total)

    return {
      activeTickets: activeOpen + activeInProgress + activePendingCustomer,
      activeOpen,
      activeInProgress,
      activePendingCustomer,
      newToday: toNumber(newTodayRows[0]?.total),
      resolvedToday: toNumber(resolvedTodayRows[0]?.total),
      available: true,
    }
  } catch {
    return {
      activeTickets: 0,
      activeOpen: 0,
      activeInProgress: 0,
      activePendingCustomer: 0,
      newToday: 0,
      resolvedToday: 0,
      available: false,
    }
  }
}

async function getSalesOverviewSummary(): Promise<SalesOverviewSummary> {
  try {
    const data = await getSalesOverviewData()
    return {
      leadsThisMonth: data.leadsThisMonth,
      appointmentsThisMonth: data.appointmentsThisMonth,
      completionRate: data.completionRate,
      available: true,
    }
  } catch {
    return {
      leadsThisMonth: 0,
      appointmentsThisMonth: 0,
      completionRate: null,
      available: false,
    }
  }
}

async function getMerchantsOverview(): Promise<MerchantsOverview> {
  try {
    const [[statusRows], [outletRows]] = await Promise.all([
      queryWithReconnect<MerchantStatusRow[]>(
        `
        SELECT
          COUNT(*) AS total,
          SUM(CASE WHEN ${CLOSED_FLAG_SQL} THEN 0 WHEN ${TEST_FLAG_SQL} THEN 0 ELSE 1 END) AS live_total,
          SUM(CASE WHEN ${CLOSED_FLAG_SQL} THEN 0 WHEN ${TEST_FLAG_SQL} THEN 1 ELSE 0 END) AS test_total,
          SUM(CASE WHEN ${CLOSED_FLAG_SQL} THEN 1 ELSE 0 END) AS closed_total
        FROM merchants
      `
      ),
      queryWithReconnect<CountRow[]>(`SELECT COUNT(*) AS total FROM merchant_outlets`),
    ])

    return {
      total: toNumber(statusRows[0]?.total),
      live: toNumber(statusRows[0]?.live_total),
      test: toNumber(statusRows[0]?.test_total),
      closed: toNumber(statusRows[0]?.closed_total),
      outlets: toNumber(outletRows[0]?.total),
      available: true,
    }
  } catch {
    return { total: 0, live: 0, test: 0, closed: 0, outlets: 0, available: false }
  }
}

async function getCsatOverview(): Promise<CsatOverview> {
  try {
    const [rows] = await queryWithReconnect<SatisfactionRow[]>(
      `
      SELECT
        AVG(${scoreCaseSql("support_satisfaction")}) AS support_avg,
        AVG(${scoreCaseSql("product_satisfaction")}) AS product_avg
      FROM tickets
      WHERE ${activeSupportRequestWhere()}
    `
    )

    return {
      supportAverage: toAverage(rows[0]?.support_avg),
      productAverage: toAverage(rows[0]?.product_avg),
      available: true,
    }
  } catch {
    return { supportAverage: null, productAverage: null, available: false }
  }
}

export async function getGeneralOverviewData(): Promise<GeneralOverviewData> {
  const [merchantSuccess, sales, merchants, csat] = await Promise.all([
    getMerchantSuccessOverview(),
    getSalesOverviewSummary(),
    getMerchantsOverview(),
    getCsatOverview(),
  ])

  return { merchantSuccess, sales, merchants, csat }
}
