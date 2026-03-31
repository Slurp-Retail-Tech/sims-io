import "server-only"

import { queryWithReconnect } from "@/lib/db"

type LeadMonthRow = {
  this_month: number | string
  last_month: number | string
}

type ApptMonthRow = {
  this_month: number | string
  last_month: number | string
}

type CompletionRow = {
  completed: number | string
  canceled: number | string
}

type DailyRow = {
  day: string
  total: number | string
}

type SourceRow = {
  source_label: string
  total: number | string
}

export type SalesOverviewData = {
  leadsThisMonth: number
  leadsDelta: number
  appointmentsThisMonth: number
  appointmentsDelta: number
  completionRate: number | null
  leadsByDay: Array<{ day: string; total: number }>
  topSources: Array<{ sourceLabel: string; total: number }>
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

export async function getSalesOverviewData(): Promise<SalesOverviewData> {
  const [
    [leadMonthRows],
    [apptMonthRows],
    [completionRows],
    [dailyRows],
    [sourceRows],
  ] = await Promise.all([
    queryWithReconnect<LeadMonthRow[]>(
      `
        SELECT
          SUM(CASE WHEN DATE_FORMAT(created_at, '%Y-%m') = DATE_FORMAT(NOW(), '%Y-%m') THEN 1 ELSE 0 END) AS this_month,
          SUM(CASE WHEN DATE_FORMAT(created_at, '%Y-%m') = DATE_FORMAT(DATE_SUB(NOW(), INTERVAL 1 MONTH), '%Y-%m') THEN 1 ELSE 0 END) AS last_month
        FROM leads
        WHERE archived = 0
      `
    ),
    queryWithReconnect<ApptMonthRow[]>(
      `
        SELECT
          SUM(CASE WHEN DATE_FORMAT(created_at, '%Y-%m') = DATE_FORMAT(NOW(), '%Y-%m') THEN 1 ELSE 0 END) AS this_month,
          SUM(CASE WHEN DATE_FORMAT(created_at, '%Y-%m') = DATE_FORMAT(DATE_SUB(NOW(), INTERVAL 1 MONTH), '%Y-%m') THEN 1 ELSE 0 END) AS last_month
        FROM sales_appointments
      `
    ),
    queryWithReconnect<CompletionRow[]>(
      `
        SELECT
          SUM(CASE WHEN status = 'Completed' THEN 1 ELSE 0 END) AS completed,
          SUM(CASE WHEN status = 'Canceled' THEN 1 ELSE 0 END) AS canceled
        FROM sales_appointments
      `
    ),
    queryWithReconnect<DailyRow[]>(
      `
        SELECT DATE(created_at) AS day, COUNT(*) AS total
        FROM leads
        WHERE archived = 0
          AND created_at >= DATE_SUB(CURDATE(), INTERVAL 29 DAY)
        GROUP BY DATE(created_at)
        ORDER BY day ASC
      `
    ),
    queryWithReconnect<SourceRow[]>(
      `
        SELECT
          COALESCE(NULLIF(TRIM(source), ''), 'Unknown') AS source_label,
          COUNT(*) AS total
        FROM leads
        WHERE archived = 0
        GROUP BY COALESCE(NULLIF(TRIM(source), ''), 'Unknown')
        ORDER BY total DESC
        LIMIT 8
      `
    ),
  ])

  const leadMonth = leadMonthRows[0]
  const apptMonth = apptMonthRows[0]
  const completion = completionRows[0]

  const leadsThisMonth = toNumber(leadMonth?.this_month)
  const leadsLastMonth = toNumber(leadMonth?.last_month)
  const appointmentsThisMonth = toNumber(apptMonth?.this_month)
  const appointmentsLastMonth = toNumber(apptMonth?.last_month)
  const completed = toNumber(completion?.completed)
  const canceled = toNumber(completion?.canceled)
  const closedTotal = completed + canceled
  const completionRate = closedTotal > 0 ? (completed / closedTotal) * 100 : null

  return {
    leadsThisMonth,
    leadsDelta: leadsThisMonth - leadsLastMonth,
    appointmentsThisMonth,
    appointmentsDelta: appointmentsThisMonth - appointmentsLastMonth,
    completionRate,
    leadsByDay: dailyRows.map((row) => ({
      day: String(row.day),
      total: toNumber(row.total),
    })),
    topSources: sourceRows.map((row) => ({
      sourceLabel: row.source_label,
      total: toNumber(row.total),
    })),
  }
}
