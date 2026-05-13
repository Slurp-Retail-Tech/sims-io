import "server-only"

import { getAppYear, localSqlDate, localSqlMonth } from "@/lib/app-timezone"
import { queryWithReconnect } from "@/lib/db"
import type { SalesPeriodMode, SalesFilterQuery } from "../filter-state"

type MonthRow = { month_value: string }

type LeadKpiRow = {
  total: number | string
  archived_total: number | string
}

type ApptStatusRow = {
  status: string
  total: number | string
}

type BucketRow = {
  bucket: string
  total: number | string
}

type ApptStatusBucketRow = {
  bucket: string
  status: string
  total: number | string
}

type ApptTypeBucketRow = {
  bucket: string
  appointment_type: string
  total: number | string
}

type SourceRow = {
  source_label: string
  total: number | string
}

type TypeRow = {
  type_label: string
  total: number | string
}

export type SalesAnalyticsData = {
  totalLeads: number
  archivedLeads: number
  appointmentsPending: number
  appointmentsCompleted: number
  appointmentsCanceled: number
  completionRate: number | null
  cancellationRate: number | null
  leadBuckets: Array<{ bucket: string; total: number }>
  bucketMode: "monthly" | "daily"
  apptStatusBuckets: Array<{
    bucket: string
    pending: number
    completed: number
    canceled: number
  }>
  apptTypeBuckets: Array<{ bucket: string; online: number; physical: number }>
  topSources: Array<{ sourceLabel: string; total: number }>
  topBusinessTypes: Array<{ typeLabel: string; total: number }>
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

function toValidMonthInput(value: string | string[] | undefined): string | null {
  if (typeof value !== "string") return null
  if (!/^\d{4}-\d{2}$/.test(value)) return null
  const [yearText, monthText] = value.split("-")
  const year = Number(yearText)
  const month = Number(monthText)
  if (!Number.isFinite(year) || !Number.isFinite(month) || month < 1 || month > 12) return null
  return value
}

function toValidYearInput(value: string | string[] | undefined): string | null {
  if (typeof value !== "string") return null
  if (!/^\d{4}$/.test(value)) return null
  const year = Number(value)
  if (!Number.isFinite(year) || year < 2000 || year > 2100) return null
  return value
}

function getMonthDateRange(monthValue: string | null): { fromDate: string | null; toDate: string | null } {
  if (!monthValue) return { fromDate: null, toDate: null }
  const [yearText, monthText] = monthValue.split("-")
  const year = Number(yearText)
  const month = Number(monthText)
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate()
  return {
    fromDate: `${monthValue}-01`,
    toDate: `${monthValue}-${String(lastDay).padStart(2, "0")}`,
  }
}

function getYearDateRange(yearValue: string | null): { fromDate: string | null; toDate: string | null } {
  if (!yearValue) return { fromDate: null, toDate: null }
  return { fromDate: `${yearValue}-01-01`, toDate: `${yearValue}-12-31` }
}

function buildDateClause(
  column: string,
  fromDate: string | null,
  toDate: string | null
): { sql: string; values: string[] } {
  const clauses: string[] = []
  const values: string[] = []
  if (fromDate) {
    clauses.push(`${localSqlDate(column)} >= ?`)
    values.push(fromDate)
  }
  if (toDate) {
    clauses.push(`${localSqlDate(column)} <= ?`)
    values.push(toDate)
  }
  return clauses.length
    ? { sql: ` AND ${clauses.join(" AND ")}`, values }
    : { sql: "", values }
}

export async function getSalesAvailablePeriods(): Promise<{
  months: string[]
  years: string[]
}> {
  const leadCreatedMonth = localSqlMonth("created_at")
  const [rows] = await queryWithReconnect<MonthRow[]>(
    `
      SELECT ${leadCreatedMonth} AS month_value FROM leads
      GROUP BY ${leadCreatedMonth}
      UNION
      SELECT ${leadCreatedMonth} AS month_value FROM sales_appointments
      GROUP BY ${leadCreatedMonth}
      ORDER BY month_value DESC
    `
  )

  const months = rows
    .map((row) => toValidMonthInput(row.month_value))
    .filter((v): v is string => Boolean(v))

  const currentYear = getAppYear()
  const years = Array.from(
    new Set([...months.map((m) => m.slice(0, 4)), currentYear])
  ).sort((a, b) => Number(b) - Number(a))

  return { months, years }
}

function normalizePeriodMode(rawPeriod: string | undefined): SalesPeriodMode {
  if (rawPeriod === "all" || rawPeriod === "monthly" || rawPeriod === "yearly") {
    return rawPeriod
  }
  return "yearly"
}

export function resolveSalesFilter({
  query,
  availableMonths,
  availableYears,
}: {
  query: SalesFilterQuery | undefined
  availableMonths: string[]
  availableYears: string[]
}): {
  mode: SalesPeriodMode
  selectedMonth: string | null
  selectedYear: string | null
  fromDate: string | null
  toDate: string | null
} {
  const mode = normalizePeriodMode(query?.period)
  const currentYear = getAppYear()
  const parsedMonth = toValidMonthInput(query?.month)
  const parsedYear =
    toValidYearInput(query?.year) ?? (parsedMonth ? parsedMonth.slice(0, 4) : currentYear)

  const selectedMonth =
    mode === "monthly"
      ? (parsedMonth && availableMonths.includes(parsedMonth)
          ? parsedMonth
          : (availableMonths[0] ?? null))
      : (parsedMonth && availableMonths.includes(parsedMonth) ? parsedMonth : null)

  const selectedYear =
    mode === "yearly"
      ? (parsedYear && availableYears.includes(parsedYear)
          ? parsedYear
          : (availableYears.includes(currentYear) ? currentYear : (availableYears[0] ?? null)))
      : (parsedYear && availableYears.includes(parsedYear) ? parsedYear : null)

  const dateRange =
    mode === "monthly"
      ? getMonthDateRange(selectedMonth)
      : mode === "yearly"
        ? getYearDateRange(selectedYear)
        : { fromDate: null, toDate: null }

  return {
    mode,
    selectedMonth,
    selectedYear,
    fromDate: dateRange.fromDate,
    toDate: dateRange.toDate,
  }
}

export async function getSalesAnalyticsData({
  mode,
  fromDate,
  toDate,
}: {
  mode: SalesPeriodMode
  fromDate: string | null
  toDate: string | null
}): Promise<SalesAnalyticsData> {
  const bucketMode: "monthly" | "daily" = mode === "monthly" ? "daily" : "monthly"
  const bucketExpr =
    bucketMode === "daily" ? localSqlDate("created_at") : localSqlMonth("created_at")

  const leadDateClause = buildDateClause("created_at", fromDate, toDate)
  const apptDateClause = buildDateClause("created_at", fromDate, toDate)

  const [
    [leadKpiRows],
    [apptStatusRows],
    [leadBucketRows],
    [apptStatusBucketRows],
    [apptTypeBucketRows],
    [sourceRows],
    [typeRows],
  ] = await Promise.all([
    queryWithReconnect<LeadKpiRow[]>(
      `
        SELECT COUNT(*) AS total, SUM(archived) AS archived_total
        FROM leads
        WHERE 1=1${leadDateClause.sql}
      `,
      leadDateClause.values
    ),
    queryWithReconnect<ApptStatusRow[]>(
      `
        SELECT status, COUNT(*) AS total
        FROM sales_appointments
        WHERE 1=1${apptDateClause.sql}
        GROUP BY status
      `,
      apptDateClause.values
    ),
    queryWithReconnect<BucketRow[]>(
      `
        SELECT ${bucketExpr} AS bucket, COUNT(*) AS total
        FROM leads
        WHERE archived = 0${leadDateClause.sql}
        GROUP BY ${bucketExpr}
        ORDER BY bucket ASC
      `,
      leadDateClause.values
    ),
    queryWithReconnect<ApptStatusBucketRow[]>(
      `
        SELECT ${bucketExpr} AS bucket, status, COUNT(*) AS total
        FROM sales_appointments
        WHERE 1=1${apptDateClause.sql}
        GROUP BY ${bucketExpr}, status
        ORDER BY bucket ASC
      `,
      apptDateClause.values
    ),
    queryWithReconnect<ApptTypeBucketRow[]>(
      `
        SELECT ${bucketExpr} AS bucket, appointment_type, COUNT(*) AS total
        FROM sales_appointments
        WHERE 1=1${apptDateClause.sql}
        GROUP BY ${bucketExpr}, appointment_type
        ORDER BY bucket ASC
      `,
      apptDateClause.values
    ),
    queryWithReconnect<SourceRow[]>(
      `
        SELECT
          COALESCE(NULLIF(TRIM(source), ''), 'Unknown') AS source_label,
          COUNT(*) AS total
        FROM leads
        WHERE archived = 0${leadDateClause.sql}
        GROUP BY COALESCE(NULLIF(TRIM(source), ''), 'Unknown')
        ORDER BY total DESC
        LIMIT 8
      `,
      leadDateClause.values
    ),
    queryWithReconnect<TypeRow[]>(
      `
        SELECT
          COALESCE(NULLIF(TRIM(business_type), ''), 'Unknown') AS type_label,
          COUNT(*) AS total
        FROM leads
        WHERE archived = 0${leadDateClause.sql}
        GROUP BY COALESCE(NULLIF(TRIM(business_type), ''), 'Unknown')
        ORDER BY total DESC
        LIMIT 8
      `,
      leadDateClause.values
    ),
  ])

  const totalLeads = toNumber(leadKpiRows[0]?.total)
  const archivedLeads = toNumber(leadKpiRows[0]?.archived_total)

  const apptByStatus = new Map<string, number>()
  for (const row of apptStatusRows) {
    apptByStatus.set(row.status, toNumber(row.total))
  }
  const appointmentsPending = apptByStatus.get("Pending") ?? 0
  const appointmentsCompleted = apptByStatus.get("Completed") ?? 0
  const appointmentsCanceled = apptByStatus.get("Canceled") ?? 0
  const closedTotal = appointmentsCompleted + appointmentsCanceled
  const completionRate = closedTotal > 0 ? (appointmentsCompleted / closedTotal) * 100 : null
  const cancellationRate = closedTotal > 0 ? (appointmentsCanceled / closedTotal) * 100 : null

  // Group appointment status buckets
  const apptStatusMap = new Map<
    string,
    { pending: number; completed: number; canceled: number }
  >()
  for (const row of apptStatusBucketRows) {
    const key = String(row.bucket)
    const entry = apptStatusMap.get(key) ?? { pending: 0, completed: 0, canceled: 0 }
    const count = toNumber(row.total)
    if (row.status === "Pending") entry.pending += count
    else if (row.status === "Completed") entry.completed += count
    else if (row.status === "Canceled") entry.canceled += count
    apptStatusMap.set(key, entry)
  }

  // Group appointment type buckets
  const apptTypeMap = new Map<string, { online: number; physical: number }>()
  for (const row of apptTypeBucketRows) {
    const key = String(row.bucket)
    const entry = apptTypeMap.get(key) ?? { online: 0, physical: 0 }
    const count = toNumber(row.total)
    if (row.appointment_type === "Online") entry.online += count
    else if (row.appointment_type === "Physical") entry.physical += count
    apptTypeMap.set(key, entry)
  }

  return {
    totalLeads,
    archivedLeads,
    appointmentsPending,
    appointmentsCompleted,
    appointmentsCanceled,
    completionRate,
    cancellationRate,
    leadBuckets: leadBucketRows.map((row) => ({
      bucket: String(row.bucket),
      total: toNumber(row.total),
    })),
    bucketMode,
    apptStatusBuckets: Array.from(apptStatusMap.entries()).map(([bucket, counts]) => ({
      bucket,
      ...counts,
    })),
    apptTypeBuckets: Array.from(apptTypeMap.entries()).map(([bucket, counts]) => ({
      bucket,
      ...counts,
    })),
    topSources: sourceRows.map((row) => ({
      sourceLabel: row.source_label,
      total: toNumber(row.total),
    })),
    topBusinessTypes: typeRows.map((row) => ({
      typeLabel: row.type_label,
      total: toNumber(row.total),
    })),
  }
}
