import { queryWithReconnect } from "@/lib/db"
import { activeSupportRequestWhere } from "@/lib/analytics-ticket-filters"
import type { AnalyticsFilterQuery, AnalyticsPeriodMode } from "./filter-state"

type OverviewRow = {
  total_tickets: number | string
  resolved_tickets: number | string
  avg_resolve_minutes: number | string | null
  active_days: number | string
  first_day: string | null
  last_day: string | null
}

type HourlyRow = {
  hour_of_day: number | string
  total: number | string
}

type MerchantOutletRow = {
  fid: string
  franchise_name: string
  oid: string
  outlet_name: string
  total: number | string
}

type MerchantFrequencyRow = {
  fid: string
  franchise_name: string
  issue_type: string
  month_value: string
  total: number | string
}

type IssueRow = {
  category: string
  subcategory1: string
  subcategory2: string
  total: number | string
  avg_resolve_minutes: number | string | null
}

type IssueMonthlyRow = {
  month_value: string
  category: string
  subcategory1: string
  subcategory2: string
  total_tickets: number | string
  duration_hours: number | string | null
}

type LabelCountRow = {
  label: string
  total: number | string
}

type MsRow = {
  ms_name: string
  total_tickets: number | string
  resolved_tickets: number | string
  avg_resolve_minutes: number | string | null
}

type MsMonthlyRow = {
  month_value: string
  ms_name: string
  total_tickets: number | string
  duration_minutes: number | string | null
}

type DailyRow = {
  day: string
  total: number | string
}

type SentimentRow = {
  sentiment: string
  total: number | string
}

type MonthRow = {
  month_value: string
}

type ColumnExistsRow = {
  column_exists: number | string
}

export type AnalyticsData = {
  totalTickets: number
  resolvedTickets: number
  totalAvgResolveMinutes: number | null
  ticketsPerDay: number
  hourly: Array<{ hour: number; label: string; total: number }>
  busiestHour: { hour: number; label: string; total: number } | null
  merchants: Array<{ fid: string; franchiseName: string; total: number }>
  merchantOutlets: Array<{
    key: string
    fid: string
    franchiseName: string
    oid: string
    outletName: string
    total: number
  }>
  merchantFrequency: {
    months: Array<{ key: string; label: string }>
    rows: Array<{
      id: string
      rowType: "group" | "detail" | "subtotal"
      fid: string
      franchiseName: string
      issueType: string
      monthly: Record<string, number>
      grandTotal: number
    }>
  }
  issues: Array<{
    issueLabel: string
    category: string
    subcategory1: string
    subcategory2: string
    total: number
    avgResolveMinutes: number | null
  }>
  issueMonths: Array<{ key: string; label: string }>
  issueCategoryDurationBreakdown: Array<{
    label: string
    totalTickets: number
    totalDurationHours: number
  }>
  issueSubcategory1DurationBreakdown: Array<{
    label: string
    totalTickets: number
    totalDurationHours: number
  }>
  issueSubcategory2DurationBreakdown: Array<{
    label: string
    totalTickets: number
    totalDurationHours: number
  }>
  issuePivotRows: Array<{
    id: string
    level: 0 | 1 | 2
    rowType: "group" | "detail" | "subtotal"
    category: string
    subcategory1: string
    subcategory2: string
    monthly: Record<
      string,
      {
        totalTickets: number
        durationHours: number
      }
    >
    grandTotalTickets: number
    grandTotalDurationHours: number
  }>
  topIssue: {
    issueLabel: string
    category: string
    subcategory1: string
    subcategory2: string
    total: number
    avgResolveMinutes: number | null
  } | null
  categoryBreakdown: Array<{ label: string; total: number }>
  subcategory1Breakdown: Array<{ label: string; total: number }>
  subcategory2Breakdown: Array<{ label: string; total: number }>
  msBreakdown: Array<{
    name: string
    totalTickets: number
    resolvedTickets: number
    avgResolveMinutes: number | null
    ticketsPerDay: number
  }>
  msMonths: Array<{ key: string; label: string }>
  msMonthlyBreakdown: Array<{
    name: string
    monthly: Record<string, number>
    grandTotal: number
  }>
  msPivotRows: Array<{
    id: string
    monthKey: string
    monthLabel: string
    msName: string
    totalTickets: number
    durationMinutes: number
    avgDurationMinutes: number
    avgDurationHours: number
  }>
  msPivotGrandTotal: {
    totalTickets: number
    durationMinutes: number
    avgDurationMinutes: number
    avgDurationHours: number
  }
  daily: Array<{ day: string; total: number }>
  sentimentBreakdown: Array<{ label: string; total: number }>
}

function toNumber(value: number | string | null | undefined) {
  if (typeof value === "number") {
    return value
  }
  if (typeof value === "string") {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : 0
  }
  return 0
}

async function tableColumnExists(tableName: string, columnName: string) {
  const [rows] = await queryWithReconnect<ColumnExistsRow[]>(
    `
    SELECT COUNT(*) AS column_exists
    FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = ?
      AND COLUMN_NAME = ?
  `,
    [tableName, columnName]
  )

  return toNumber(rows[0]?.column_exists) > 0
}

function toNullableNumber(value: number | string | null | undefined) {
  if (value === null || value === undefined) {
    return null
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null
  }
  if (typeof value === "string") {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

function toRoundedHours(value: number | string | null | undefined) {
  const numeric = toNullableNumber(value)
  if (numeric === null) {
    return 0
  }
  return Number(numeric.toFixed(3))
}

function toRoundedOneDecimal(value: number) {
  return Number(value.toFixed(1))
}

export function toValidDateInput(value: string | string[] | undefined) {
  if (typeof value !== "string") {
    return null
  }
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null
}

export function toValidMonthInput(value: string | string[] | undefined) {
  if (typeof value !== "string") {
    return null
  }

  if (!/^\d{4}-\d{2}$/.test(value)) {
    return null
  }

  const [yearText, monthText] = value.split("-")
  const year = Number(yearText)
  const month = Number(monthText)

  if (!Number.isFinite(year) || !Number.isFinite(month)) {
    return null
  }

  if (month < 1 || month > 12) {
    return null
  }

  return value
}

export function getMonthDateRange(monthValue: string | null) {
  if (!monthValue) {
    return { fromDate: null, toDate: null }
  }

  const [yearText, monthText] = monthValue.split("-")
  const year = Number(yearText)
  const month = Number(monthText)
  const startDate = `${monthValue}-01`
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate()
  const endDate = `${monthValue}-${String(lastDay).padStart(2, "0")}`

  return {
    fromDate: startDate,
    toDate: endDate,
  }
}

export async function getAnalyticsAvailableMonths() {
  const [rows] = await queryWithReconnect<MonthRow[]>(
    `
      SELECT DATE_FORMAT(COALESCE(tickets.attended_at, tickets.created_at), '%Y-%m') AS month_value
      FROM tickets
      WHERE ${activeSupportRequestWhere()}
      GROUP BY DATE_FORMAT(COALESCE(tickets.attended_at, tickets.created_at), '%Y-%m')
      ORDER BY month_value DESC
    `
  )

  return rows
    .map((row) => toValidMonthInput(row.month_value))
    .filter((value): value is string => Boolean(value))
}

function buildDateWhereClause(
  column: string,
  fromDate: string | null,
  toDate: string | null
) {
  const clauses: string[] = []
  const values: string[] = []

  if (fromDate) {
    clauses.push(`DATE(${column}) >= ?`)
    values.push(fromDate)
  }

  if (toDate) {
    clauses.push(`DATE(${column}) <= ?`)
    values.push(toDate)
  }

  if (!clauses.length) {
    return { sql: "", values }
  }

  return {
    sql: ` AND ${clauses.join(" AND ")}`,
    values,
  }
}

function formatHour(hour: number) {
  if (hour === 0) {
    return "12 AM"
  }
  if (hour < 12) {
    return `${hour} AM`
  }
  if (hour === 12) {
    return "12 PM"
  }
  return `${hour - 12} PM`
}

function formatMonthHeading(monthValue: string) {
  const [yearText, monthText] = monthValue.split("-")
  const year = Number(yearText)
  const month = Number(monthText)

  if (!Number.isFinite(year) || !Number.isFinite(month) || month < 1 || month > 12) {
    return monthValue
  }

  const date = new Date(Date.UTC(year, month - 1, 1))
  return `${year}-${date.toLocaleDateString("en-US", { month: "short", timeZone: "UTC" })}`
}

function toUtcDate(value: string | null) {
  if (!value) {
    return null
  }
  const parsed = new Date(`${value}T00:00:00Z`)
  return Number.isNaN(parsed.valueOf()) ? null : parsed
}

function getWindowDays({
  mode,
  fromDate,
  toDate,
  firstDay,
  lastDay,
  activeDays,
}: {
  mode: AnalyticsPeriodMode
  fromDate: string | null
  toDate: string | null
  firstDay: string | null
  lastDay: string | null
  activeDays: number
}) {
  const from = toUtcDate(fromDate) ?? toUtcDate(firstDay)
  const to = toUtcDate(toDate) ?? toUtcDate(lastDay)

  if (from && to) {
    const start = from.getTime() <= to.getTime() ? from : to
    const end = from.getTime() <= to.getTime() ? to : from
    return Math.max(1, Math.floor((end.getTime() - start.getTime()) / 86_400_000) + 1)
  }

  if (mode !== "all" && (fromDate || toDate)) {
    return Math.max(1, activeDays)
  }

  return Math.max(1, activeDays)
}

function normalizeLabel(value: string, fallback: string) {
  const trimmed = value.trim()
  return trimmed || fallback
}

function buildIssueHierarchyLabel(category: string, subcategory1: string, subcategory2: string) {
  const segments = [category, subcategory1]

  if (subcategory2 !== "Unspecified") {
    segments.push(subcategory2)
  }

  return segments.join(" / ")
}

function topByCount<T extends { total: number }>(rows: T[]) {
  if (!rows.length) {
    return null
  }
  return rows.reduce((current, next) => (next.total > current.total ? next : current))
}

function addIssueMetric(
  target: Record<string, { totalTickets: number; durationHours: number }>,
  monthKey: string,
  totalTickets: number,
  durationHours: number
) {
  const existing = target[monthKey]
  if (existing) {
    existing.totalTickets += totalTickets
    existing.durationHours = Number((existing.durationHours + durationHours).toFixed(3))
    return
  }

  target[monthKey] = {
    totalTickets,
    durationHours,
  }
}

export async function getMerchantSuccessAnalyticsData({
  mode,
  fromDate,
  toDate,
}: {
  mode: AnalyticsPeriodMode
  fromDate: string | null
  toDate: string | null
}): Promise<AnalyticsData> {
  const applyPeriod = mode !== "all"
  const dateFilter = applyPeriod
    ? buildDateWhereClause("COALESCE(tickets.attended_at, tickets.created_at)", fromDate, toDate)
    : { sql: "", values: [] as string[] }

  const values = dateFilter.values
  const hasMerchantSentiment = await tableColumnExists("tickets", "merchant_sentiment")
  const sentimentExpression = hasMerchantSentiment
    ? "COALESCE(NULLIF(TRIM(tickets.merchant_sentiment), ''), 'Not Set')"
    : "'Not Set'"

  const [
    [overviewRows],
    [hourlyRows],
    [merchantOutletRows],
    [merchantFrequencyRows],
    [issueRows],
    [issueMonthlyRows],
    [categoryRows],
    [subcategory1Rows],
    [subcategory2Rows],
    [msRows],
    [msMonthlyRows],
    [dailyRows],
    [sentimentRows],
  ] = await Promise.all([
    queryWithReconnect<OverviewRow[]>(
      `
      SELECT
        COUNT(*) AS total_tickets,
        SUM(CASE WHEN tickets.status = 'Resolved' THEN 1 ELSE 0 END) AS resolved_tickets,
        AVG(
          CASE
            WHEN tickets.status = 'Resolved' THEN TIMESTAMPDIFF(
              MINUTE,
              COALESCE(tickets.attended_at, tickets.created_at),
              COALESCE(tickets.closed_at, tickets.updated_at)
            )
            ELSE NULL
          END
        ) AS avg_resolve_minutes,
        COUNT(DISTINCT DATE(COALESCE(tickets.attended_at, tickets.created_at))) AS active_days,
        MIN(DATE(COALESCE(tickets.attended_at, tickets.created_at))) AS first_day,
        MAX(DATE(COALESCE(tickets.attended_at, tickets.created_at))) AS last_day
      FROM tickets
      WHERE ${activeSupportRequestWhere()}
      ${dateFilter.sql}
    `,
      values
    ),
    queryWithReconnect<HourlyRow[]>(
      `
      SELECT
        HOUR(COALESCE(tickets.attended_at, tickets.created_at)) AS hour_of_day,
        COUNT(*) AS total
      FROM tickets
      WHERE ${activeSupportRequestWhere()}
      ${dateFilter.sql}
      GROUP BY HOUR(COALESCE(tickets.attended_at, tickets.created_at))
      ORDER BY hour_of_day ASC
    `,
      values
    ),
    queryWithReconnect<MerchantOutletRow[]>(
      `
      SELECT
        COALESCE(NULLIF(TRIM(tickets.fid), ''), '--') AS fid,
        COALESCE(NULLIF(TRIM(tickets.franchise_name_resolved), ''), 'Unknown franchise') AS franchise_name,
        COALESCE(NULLIF(TRIM(tickets.oid), ''), '--') AS oid,
        COALESCE(NULLIF(TRIM(tickets.outlet_name_resolved), ''), 'Unknown outlet') AS outlet_name,
        COUNT(*) AS total
      FROM tickets
      WHERE ${activeSupportRequestWhere()}
      ${dateFilter.sql}
      GROUP BY
        COALESCE(NULLIF(TRIM(tickets.fid), ''), '--'),
        COALESCE(NULLIF(TRIM(tickets.franchise_name_resolved), ''), 'Unknown franchise'),
        COALESCE(NULLIF(TRIM(tickets.oid), ''), '--'),
        COALESCE(NULLIF(TRIM(tickets.outlet_name_resolved), ''), 'Unknown outlet')
      ORDER BY total DESC
    `,
      values
    ),
    queryWithReconnect<MerchantFrequencyRow[]>(
      `
      SELECT
        COALESCE(NULLIF(TRIM(tickets.fid), ''), '--') AS fid,
        COALESCE(NULLIF(TRIM(tickets.franchise_name_resolved), ''), 'Unknown franchise') AS franchise_name,
        COALESCE(NULLIF(TRIM(tickets.issue_type), ''), 'Uncategorized') AS issue_type,
        DATE_FORMAT(COALESCE(tickets.attended_at, tickets.created_at), '%Y-%m') AS month_value,
        COUNT(*) AS total
      FROM tickets
      WHERE ${activeSupportRequestWhere()}
      ${dateFilter.sql}
      GROUP BY
        COALESCE(NULLIF(TRIM(tickets.fid), ''), '--'),
        COALESCE(NULLIF(TRIM(tickets.franchise_name_resolved), ''), 'Unknown franchise'),
        COALESCE(NULLIF(TRIM(tickets.issue_type), ''), 'Uncategorized'),
        DATE_FORMAT(COALESCE(tickets.attended_at, tickets.created_at), '%Y-%m')
      ORDER BY franchise_name ASC, fid ASC, issue_type ASC, month_value DESC
    `,
      values
    ),
    queryWithReconnect<IssueRow[]>(
      `
      SELECT
        COALESCE(NULLIF(TRIM(tickets.issue_type), ''), 'Uncategorized') AS category,
        COALESCE(NULLIF(TRIM(tickets.issue_subcategory1), ''), 'Unspecified') AS subcategory1,
        COALESCE(NULLIF(TRIM(tickets.issue_subcategory2), ''), 'Unspecified') AS subcategory2,
        COUNT(*) AS total,
        AVG(
          CASE
            WHEN tickets.status = 'Resolved' THEN TIMESTAMPDIFF(
              MINUTE,
              COALESCE(tickets.attended_at, tickets.created_at),
              COALESCE(tickets.closed_at, tickets.updated_at)
            )
            ELSE NULL
          END
        ) AS avg_resolve_minutes
      FROM tickets
      WHERE ${activeSupportRequestWhere()}
      ${dateFilter.sql}
      GROUP BY
        COALESCE(NULLIF(TRIM(tickets.issue_type), ''), 'Uncategorized'),
        COALESCE(NULLIF(TRIM(tickets.issue_subcategory1), ''), 'Unspecified'),
        COALESCE(NULLIF(TRIM(tickets.issue_subcategory2), ''), 'Unspecified')
      ORDER BY total DESC
    `,
      values
    ),
    queryWithReconnect<IssueMonthlyRow[]>(
      `
      SELECT
        DATE_FORMAT(COALESCE(tickets.attended_at, tickets.created_at), '%Y-%m') AS month_value,
        COALESCE(NULLIF(TRIM(tickets.issue_type), ''), 'Uncategorized') AS category,
        COALESCE(NULLIF(TRIM(tickets.issue_subcategory1), ''), 'Unspecified') AS subcategory1,
        COALESCE(NULLIF(TRIM(tickets.issue_subcategory2), ''), 'Unspecified') AS subcategory2,
        COUNT(*) AS total_tickets,
        SUM(
          TIMESTAMPDIFF(
            SECOND,
            COALESCE(tickets.attended_at, tickets.created_at),
            COALESCE(tickets.closed_at, tickets.updated_at, COALESCE(tickets.attended_at, tickets.created_at))
          )
        ) / 3600 AS duration_hours
      FROM tickets
      WHERE ${activeSupportRequestWhere()}
      ${dateFilter.sql}
      GROUP BY
        DATE_FORMAT(COALESCE(tickets.attended_at, tickets.created_at), '%Y-%m'),
        COALESCE(NULLIF(TRIM(tickets.issue_type), ''), 'Uncategorized'),
        COALESCE(NULLIF(TRIM(tickets.issue_subcategory1), ''), 'Unspecified'),
        COALESCE(NULLIF(TRIM(tickets.issue_subcategory2), ''), 'Unspecified')
      ORDER BY month_value DESC, category ASC, subcategory1 ASC, subcategory2 ASC
    `,
      values
    ),
    queryWithReconnect<LabelCountRow[]>(
      `
      SELECT
        COALESCE(NULLIF(TRIM(tickets.issue_type), ''), 'Uncategorized') AS label,
        COUNT(*) AS total
      FROM tickets
      WHERE ${activeSupportRequestWhere()}
      ${dateFilter.sql}
      GROUP BY COALESCE(NULLIF(TRIM(tickets.issue_type), ''), 'Uncategorized')
      ORDER BY total DESC
      LIMIT 8
    `,
      values
    ),
    queryWithReconnect<LabelCountRow[]>(
      `
      SELECT
        COALESCE(NULLIF(TRIM(tickets.issue_subcategory1), ''), 'Unspecified') AS label,
        COUNT(*) AS total
      FROM tickets
      WHERE ${activeSupportRequestWhere()}
      ${dateFilter.sql}
      GROUP BY COALESCE(NULLIF(TRIM(tickets.issue_subcategory1), ''), 'Unspecified')
      ORDER BY total DESC
      LIMIT 8
    `,
      values
    ),
    queryWithReconnect<LabelCountRow[]>(
      `
      SELECT
        COALESCE(NULLIF(TRIM(tickets.issue_subcategory2), ''), 'Unspecified') AS label,
        COUNT(*) AS total
      FROM tickets
      WHERE ${activeSupportRequestWhere()}
      ${dateFilter.sql}
      GROUP BY COALESCE(NULLIF(TRIM(tickets.issue_subcategory2), ''), 'Unspecified')
      ORDER BY total DESC
      LIMIT 8
    `,
      values
    ),
    queryWithReconnect<MsRow[]>(
      `
      SELECT
        COALESCE(NULLIF(TRIM(users.name), ''), 'Unassigned') AS ms_name,
        COUNT(*) AS total_tickets,
        SUM(CASE WHEN tickets.status = 'Resolved' THEN 1 ELSE 0 END) AS resolved_tickets,
        AVG(
          CASE
            WHEN tickets.status = 'Resolved' THEN TIMESTAMPDIFF(
              MINUTE,
              COALESCE(tickets.attended_at, tickets.created_at),
              COALESCE(tickets.closed_at, tickets.updated_at)
            )
            ELSE NULL
          END
        ) AS avg_resolve_minutes
      FROM tickets
      LEFT JOIN users
        ON users.id = tickets.ms_pic_user_id
      WHERE ${activeSupportRequestWhere()}
      ${dateFilter.sql}
      GROUP BY COALESCE(NULLIF(TRIM(users.name), ''), 'Unassigned')
      ORDER BY total_tickets DESC
    `,
      values
    ),
    queryWithReconnect<MsMonthlyRow[]>(
      `
      SELECT
        DATE_FORMAT(COALESCE(tickets.attended_at, tickets.created_at), '%Y-%m') AS month_value,
        COALESCE(NULLIF(TRIM(users.name), ''), 'Unassigned') AS ms_name,
        COUNT(*) AS total_tickets,
        SUM(
          TIMESTAMPDIFF(
            SECOND,
            COALESCE(tickets.attended_at, tickets.created_at),
            COALESCE(
              tickets.closed_at,
              tickets.updated_at,
              COALESCE(tickets.attended_at, tickets.created_at)
            )
          )
        ) / 60 AS duration_minutes
      FROM tickets
      LEFT JOIN users
        ON users.id = tickets.ms_pic_user_id
      WHERE ${activeSupportRequestWhere()}
      ${dateFilter.sql}
      GROUP BY
        DATE_FORMAT(COALESCE(tickets.attended_at, tickets.created_at), '%Y-%m'),
        COALESCE(NULLIF(TRIM(users.name), ''), 'Unassigned')
      ORDER BY month_value ASC, total_tickets DESC, ms_name ASC
    `,
      values
    ),
    queryWithReconnect<DailyRow[]>(
      `
      SELECT
        DATE(COALESCE(tickets.attended_at, tickets.created_at)) AS day,
        COUNT(*) AS total
      FROM tickets
      WHERE ${activeSupportRequestWhere()}
      ${dateFilter.sql}
      GROUP BY DATE(COALESCE(tickets.attended_at, tickets.created_at))
      ORDER BY day ASC
    `,
      values
    ),
    queryWithReconnect<SentimentRow[]>(
      `
      SELECT
        ${sentimentExpression} AS sentiment,
        COUNT(*) AS total
      FROM tickets
      WHERE ${activeSupportRequestWhere()}
      ${dateFilter.sql}
      GROUP BY ${sentimentExpression}
      ORDER BY total DESC
    `,
      values
    ),
  ])

  const overview = overviewRows[0]
  const totalTickets = toNumber(overview?.total_tickets)
  const resolvedTickets = toNumber(overview?.resolved_tickets)
  const totalAvgResolveMinutes = toNullableNumber(overview?.avg_resolve_minutes)
  const activeDays = toNumber(overview?.active_days)
    const windowDays = getWindowDays({
      mode,
      fromDate,
      toDate,
      firstDay: overview?.first_day ?? null,
    lastDay: overview?.last_day ?? null,
    activeDays,
  })

  const hourlyMap = new Map<number, number>()
  hourlyRows.forEach((row) => {
    hourlyMap.set(toNumber(row.hour_of_day), toNumber(row.total))
  })

  const hourly = Array.from({ length: 24 }, (_, hour) => ({
    hour,
    label: formatHour(hour),
    total: hourlyMap.get(hour) ?? 0,
  }))

  const merchantMap = new Map<string, { fid: string; franchiseName: string; total: number }>()
  const merchantOutlets = merchantOutletRows.map((row) => {
    const fid = normalizeLabel(row.fid, "--")
    const franchiseName = normalizeLabel(row.franchise_name, "Unknown franchise")
    const total = toNumber(row.total)

    const existing = merchantMap.get(fid)
    if (existing) {
      existing.total += total
    } else {
      merchantMap.set(fid, { fid, franchiseName, total })
    }

    return {
      key: `${fid}-${normalizeLabel(row.oid, "--")}-${normalizeLabel(row.outlet_name, "Unknown outlet")}`,
      fid,
      franchiseName,
      oid: normalizeLabel(row.oid, "--"),
      outletName: normalizeLabel(row.outlet_name, "Unknown outlet"),
      total,
    }
  })

  const merchants = Array.from(merchantMap.values()).sort((a, b) => b.total - a.total)

  const merchantFrequencyMonths = Array.from(
    new Set(
      merchantFrequencyRows
        .map((row) => toValidMonthInput(row.month_value))
        .filter((value): value is string => Boolean(value))
    )
  )
    .sort((left, right) => right.localeCompare(left))
    .map((monthKey) => ({
      key: monthKey,
      label: formatMonthHeading(monthKey),
    }))

  const merchantFrequencyTree = merchantFrequencyRows.reduce(
    (map, row) => {
      const fid = normalizeLabel(row.fid, "--")
      const franchiseName = normalizeLabel(row.franchise_name, "Unknown franchise")
      const issueType = normalizeLabel(row.issue_type, "Uncategorized")
      const monthKey = toValidMonthInput(row.month_value) ?? row.month_value
      const total = toNumber(row.total)

      const franchiseKey = `${fid}::${franchiseName}`
      const franchiseNode =
        map.get(franchiseKey) ??
        {
          fid,
          franchiseName,
          monthly: {} as Record<string, number>,
          grandTotal: 0,
          issueTypes: new Map<string, { issueType: string; monthly: Record<string, number>; grandTotal: number }>(),
        }

      franchiseNode.monthly[monthKey] = (franchiseNode.monthly[monthKey] ?? 0) + total
      franchiseNode.grandTotal += total

      const issueNode =
        franchiseNode.issueTypes.get(issueType) ??
        {
          issueType,
          monthly: {} as Record<string, number>,
          grandTotal: 0,
        }

      issueNode.monthly[monthKey] = (issueNode.monthly[monthKey] ?? 0) + total
      issueNode.grandTotal += total

      franchiseNode.issueTypes.set(issueType, issueNode)
      map.set(franchiseKey, franchiseNode)
      return map
    },
    new Map<
      string,
      {
        fid: string
        franchiseName: string
        monthly: Record<string, number>
        grandTotal: number
        issueTypes: Map<string, { issueType: string; monthly: Record<string, number>; grandTotal: number }>
      }
    >()
  )

  const merchantFrequency: AnalyticsData["merchantFrequency"] = {
    months: merchantFrequencyMonths,
    rows: [],
  }

  Array.from(merchantFrequencyTree.values())
    .sort((left, right) => {
      if (right.grandTotal !== left.grandTotal) {
        return right.grandTotal - left.grandTotal
      }
      return left.franchiseName.localeCompare(right.franchiseName)
    })
    .forEach((franchiseNode) => {
      merchantFrequency.rows.push({
        id: `merchant:${franchiseNode.fid}:${franchiseNode.franchiseName}`,
        rowType: "group",
        fid: franchiseNode.fid,
        franchiseName: franchiseNode.franchiseName,
        issueType: "",
        monthly: franchiseNode.monthly,
        grandTotal: franchiseNode.grandTotal,
      })

      Array.from(franchiseNode.issueTypes.values())
        .sort((left, right) => {
          if (right.grandTotal !== left.grandTotal) {
            return right.grandTotal - left.grandTotal
          }
          return left.issueType.localeCompare(right.issueType)
        })
        .forEach((issueNode) => {
          merchantFrequency.rows.push({
            id: `merchant:${franchiseNode.fid}:${franchiseNode.franchiseName}:issue:${issueNode.issueType}`,
            rowType: "detail",
            fid: franchiseNode.fid,
            franchiseName: "",
            issueType: issueNode.issueType,
            monthly: issueNode.monthly,
            grandTotal: issueNode.grandTotal,
          })
        })
    })

  const issues = issueRows.map((row) => ({
    issueLabel: buildIssueHierarchyLabel(
      normalizeLabel(row.category, "Uncategorized"),
      normalizeLabel(row.subcategory1, "Unspecified"),
      normalizeLabel(row.subcategory2, "Unspecified")
    ),
    category: normalizeLabel(row.category, "Uncategorized"),
    subcategory1: normalizeLabel(row.subcategory1, "Unspecified"),
    subcategory2: normalizeLabel(row.subcategory2, "Unspecified"),
    total: toNumber(row.total),
    avgResolveMinutes: toNullableNumber(row.avg_resolve_minutes),
  }))

  const msMonthlyMetrics = msMonthlyRows.map((row) => ({
    monthKey: toValidMonthInput(row.month_value) ?? row.month_value,
    name: normalizeLabel(row.ms_name, "Unassigned"),
    totalTickets: toNumber(row.total_tickets),
  }))

  const msMonths = Array.from(new Set(msMonthlyMetrics.map((row) => row.monthKey)))
    .sort((left, right) => left.localeCompare(right))
    .map((monthKey) => ({
      key: monthKey,
      label: formatMonthHeading(monthKey),
    }))

  const msMonthlyMap = new Map<
    string,
    {
      name: string
      monthly: Record<string, number>
      grandTotal: number
    }
  >()

  msMonthlyMetrics.forEach((row) => {
    const current =
      msMonthlyMap.get(row.name) ??
      {
        name: row.name,
        monthly: {},
        grandTotal: 0,
      }

    current.monthly[row.monthKey] = (current.monthly[row.monthKey] ?? 0) + row.totalTickets
    current.grandTotal += row.totalTickets

    msMonthlyMap.set(row.name, current)
  })

  const msPivotRows = msMonthlyRows
    .map((row) => {
      const totalTickets = toNumber(row.total_tickets)
      const durationMinutes = toRoundedOneDecimal(toNumber(row.duration_minutes))
      const avgDurationMinutes =
        totalTickets > 0 ? toRoundedOneDecimal(durationMinutes / totalTickets) : 0

      return {
        id: `${row.month_value}:${normalizeLabel(row.ms_name, "Unassigned")}`,
        monthKey: toValidMonthInput(row.month_value) ?? row.month_value,
        monthLabel: formatMonthHeading(toValidMonthInput(row.month_value) ?? row.month_value),
        msName: normalizeLabel(row.ms_name, "Unassigned"),
        totalTickets,
        durationMinutes,
        avgDurationMinutes,
        avgDurationHours: toRoundedOneDecimal(avgDurationMinutes / 60),
      }
    })
    .sort((left, right) => {
      if (left.monthKey !== right.monthKey) {
        return right.monthKey.localeCompare(left.monthKey)
      }
      if (right.totalTickets !== left.totalTickets) {
        return right.totalTickets - left.totalTickets
      }
      return left.msName.localeCompare(right.msName)
    })

  const msPivotGrandTotal = (() => {
    const totalTicketsCount = msPivotRows.reduce((sum, row) => sum + row.totalTickets, 0)
    const totalDurationMinutes = toRoundedOneDecimal(
      msPivotRows.reduce((sum, row) => sum + row.durationMinutes, 0)
    )
    const avgDurationMinutes =
      totalTicketsCount > 0 ? toRoundedOneDecimal(totalDurationMinutes / totalTicketsCount) : 0

    return {
      totalTickets: totalTicketsCount,
      durationMinutes: totalDurationMinutes,
      avgDurationMinutes,
      avgDurationHours: toRoundedOneDecimal(avgDurationMinutes / 60),
    }
  })()

  const issueMonthlyMetrics = issueMonthlyRows.map((row) => ({
    monthKey: row.month_value,
    category: normalizeLabel(row.category, "Uncategorized"),
    subcategory1: normalizeLabel(row.subcategory1, "Unspecified"),
    subcategory2: normalizeLabel(row.subcategory2, "Unspecified"),
    totalTickets: toNumber(row.total_tickets),
    durationHours: toRoundedHours(row.duration_hours),
  }))

  const issueMonths = Array.from(new Set(issueMonthlyMetrics.map((row) => row.monthKey)))
    .sort((left, right) => right.localeCompare(left))
    .map((monthKey) => ({
      key: monthKey,
      label: formatMonthHeading(monthKey),
    }))

  const categoryDurationMap = new Map<
    string,
    {
      label: string
      totalTickets: number
      totalDurationHours: number
    }
  >()
  const subcategory1DurationMap = new Map<
    string,
    {
      label: string
      totalTickets: number
      totalDurationHours: number
    }
  >()
  const subcategory2DurationMap = new Map<
    string,
    {
      label: string
      totalTickets: number
      totalDurationHours: number
    }
  >()
  const issueTree = new Map<
    string,
    {
      category: string
      monthly: Record<string, { totalTickets: number; durationHours: number }>
      grandTotalTickets: number
      grandTotalDurationHours: number
      subcategory1Map: Map<
        string,
        {
          subcategory1: string
          monthly: Record<string, { totalTickets: number; durationHours: number }>
          grandTotalTickets: number
          grandTotalDurationHours: number
          subcategory2Map: Map<
            string,
            {
              subcategory2: string
              monthly: Record<string, { totalTickets: number; durationHours: number }>
              grandTotalTickets: number
              grandTotalDurationHours: number
            }
          >
        }
      >
    }
  >()

  issueMonthlyMetrics.forEach((row) => {
    const categoryMetric = categoryDurationMap.get(row.category)
    if (categoryMetric) {
      categoryMetric.totalTickets += row.totalTickets
      categoryMetric.totalDurationHours = Number(
        (categoryMetric.totalDurationHours + row.durationHours).toFixed(3)
      )
    } else {
      categoryDurationMap.set(row.category, {
        label: row.category,
        totalTickets: row.totalTickets,
        totalDurationHours: row.durationHours,
      })
    }

    const subcategory1Metric = subcategory1DurationMap.get(row.subcategory1)
    if (subcategory1Metric) {
      subcategory1Metric.totalTickets += row.totalTickets
      subcategory1Metric.totalDurationHours = Number(
        (subcategory1Metric.totalDurationHours + row.durationHours).toFixed(3)
      )
    } else {
      subcategory1DurationMap.set(row.subcategory1, {
        label: row.subcategory1,
        totalTickets: row.totalTickets,
        totalDurationHours: row.durationHours,
      })
    }

    const subcategory2Metric = subcategory2DurationMap.get(row.subcategory2)
    if (subcategory2Metric) {
      subcategory2Metric.totalTickets += row.totalTickets
      subcategory2Metric.totalDurationHours = Number(
        (subcategory2Metric.totalDurationHours + row.durationHours).toFixed(3)
      )
    } else {
      subcategory2DurationMap.set(row.subcategory2, {
        label: row.subcategory2,
        totalTickets: row.totalTickets,
        totalDurationHours: row.durationHours,
      })
    }

    const categoryNode =
      issueTree.get(row.category) ??
      {
        category: row.category,
        monthly: {},
        grandTotalTickets: 0,
        grandTotalDurationHours: 0,
        subcategory1Map: new Map(),
      }
    addIssueMetric(categoryNode.monthly, row.monthKey, row.totalTickets, row.durationHours)
    categoryNode.grandTotalTickets += row.totalTickets
    categoryNode.grandTotalDurationHours = Number(
      (categoryNode.grandTotalDurationHours + row.durationHours).toFixed(3)
    )

    const subcategory1Node =
      categoryNode.subcategory1Map.get(row.subcategory1) ??
      {
        subcategory1: row.subcategory1,
        monthly: {},
        grandTotalTickets: 0,
        grandTotalDurationHours: 0,
        subcategory2Map: new Map(),
      }
    addIssueMetric(subcategory1Node.monthly, row.monthKey, row.totalTickets, row.durationHours)
    subcategory1Node.grandTotalTickets += row.totalTickets
    subcategory1Node.grandTotalDurationHours = Number(
      (subcategory1Node.grandTotalDurationHours + row.durationHours).toFixed(3)
    )

    const subcategory2Node =
      subcategory1Node.subcategory2Map.get(row.subcategory2) ??
      {
        subcategory2: row.subcategory2,
        monthly: {},
        grandTotalTickets: 0,
        grandTotalDurationHours: 0,
      }
    addIssueMetric(subcategory2Node.monthly, row.monthKey, row.totalTickets, row.durationHours)
    subcategory2Node.grandTotalTickets += row.totalTickets
    subcategory2Node.grandTotalDurationHours = Number(
      (subcategory2Node.grandTotalDurationHours + row.durationHours).toFixed(3)
    )

    subcategory1Node.subcategory2Map.set(row.subcategory2, subcategory2Node)
    categoryNode.subcategory1Map.set(row.subcategory1, subcategory1Node)
    issueTree.set(row.category, categoryNode)
  })

  const issuePivotRows: AnalyticsData["issuePivotRows"] = []
  Array.from(issueTree.values())
    .sort((left, right) => right.grandTotalTickets - left.grandTotalTickets)
    .forEach((categoryNode) => {
      issuePivotRows.push({
        id: `category:${categoryNode.category}`,
        level: 0,
        rowType: "group",
        category: categoryNode.category,
        subcategory1: "",
        subcategory2: "",
        monthly: categoryNode.monthly,
        grandTotalTickets: categoryNode.grandTotalTickets,
        grandTotalDurationHours: categoryNode.grandTotalDurationHours,
      })

      Array.from(categoryNode.subcategory1Map.values())
        .sort((left, right) => right.grandTotalTickets - left.grandTotalTickets)
        .forEach((subcategory1Node) => {
          issuePivotRows.push({
            id: `subcategory1:${categoryNode.category}:${subcategory1Node.subcategory1}`,
            level: 1,
            rowType: "group",
            category: "",
            subcategory1: subcategory1Node.subcategory1,
            subcategory2: "",
            monthly: subcategory1Node.monthly,
            grandTotalTickets: subcategory1Node.grandTotalTickets,
            grandTotalDurationHours: subcategory1Node.grandTotalDurationHours,
          })

          Array.from(subcategory1Node.subcategory2Map.values())
            .filter((subcategory2Node) => subcategory2Node.subcategory2 !== "Unspecified")
            .sort((left, right) => right.grandTotalTickets - left.grandTotalTickets)
            .forEach((subcategory2Node) => {
              issuePivotRows.push({
                id: `subcategory2:${categoryNode.category}:${subcategory1Node.subcategory1}:${subcategory2Node.subcategory2}`,
                level: 2,
                rowType: "detail",
                category: "",
                subcategory1: "",
                subcategory2: subcategory2Node.subcategory2,
                monthly: subcategory2Node.monthly,
                grandTotalTickets: subcategory2Node.grandTotalTickets,
                grandTotalDurationHours: subcategory2Node.grandTotalDurationHours,
              })
            })
        })

      issuePivotRows.push({
        id: `category-total:${categoryNode.category}`,
        level: 0,
        rowType: "subtotal",
        category: `${categoryNode.category} Total`,
        subcategory1: "",
        subcategory2: "",
        monthly: categoryNode.monthly,
        grandTotalTickets: categoryNode.grandTotalTickets,
        grandTotalDurationHours: categoryNode.grandTotalDurationHours,
      })
    })

  return {
    totalTickets,
    resolvedTickets,
    totalAvgResolveMinutes,
    ticketsPerDay: totalTickets / windowDays,
    hourly,
    busiestHour: topByCount(hourly),
    merchants,
    merchantOutlets,
    merchantFrequency,
    issues,
    issueMonths,
    issueCategoryDurationBreakdown: Array.from(categoryDurationMap.values()).sort(
      (left, right) => right.totalTickets - left.totalTickets
    ),
    issueSubcategory1DurationBreakdown: Array.from(subcategory1DurationMap.values()).sort(
      (left, right) => right.totalTickets - left.totalTickets
    ),
    issueSubcategory2DurationBreakdown: Array.from(subcategory2DurationMap.values()).sort(
      (left, right) => right.totalTickets - left.totalTickets
    ),
    issuePivotRows,
    topIssue: topByCount(issues),
    categoryBreakdown: categoryRows.map((row) => ({
      label: normalizeLabel(row.label, "Uncategorized"),
      total: toNumber(row.total),
    })),
    subcategory1Breakdown: subcategory1Rows.map((row) => ({
      label: normalizeLabel(row.label, "Unspecified"),
      total: toNumber(row.total),
    })),
    subcategory2Breakdown: subcategory2Rows.map((row) => ({
      label: normalizeLabel(row.label, "Unspecified"),
      total: toNumber(row.total),
    })),
    msBreakdown: msRows.map((row) => ({
      name: normalizeLabel(row.ms_name, "Unassigned"),
      totalTickets: toNumber(row.total_tickets),
      resolvedTickets: toNumber(row.resolved_tickets),
      avgResolveMinutes: toNullableNumber(row.avg_resolve_minutes),
      ticketsPerDay: toNumber(row.total_tickets) / windowDays,
    })),
    msMonths,
    msMonthlyBreakdown: Array.from(msMonthlyMap.values()).sort((left, right) => {
      if (right.grandTotal !== left.grandTotal) {
        return right.grandTotal - left.grandTotal
      }
      return left.name.localeCompare(right.name)
    }),
    msPivotRows,
    msPivotGrandTotal,
    daily: dailyRows.map((row) => ({ day: row.day, total: toNumber(row.total) })),
    sentimentBreakdown: sentimentRows.map((row) => ({
      label: normalizeLabel(row.sentiment, "Not Set"),
      total: toNumber(row.total),
    })),
  }
}

export function toValidYearInput(value: string | string[] | undefined) {
  if (typeof value !== "string") {
    return null
  }

  if (!/^\d{4}$/.test(value)) {
    return null
  }

  const year = Number(value)
  if (!Number.isFinite(year) || year < 2000 || year > 2100) {
    return null
  }

  return value
}

export function getYearDateRange(yearValue: string | null) {
  if (!yearValue) {
    return { fromDate: null, toDate: null }
  }

  return {
    fromDate: `${yearValue}-01-01`,
    toDate: `${yearValue}-12-31`,
  }
}

export async function getAnalyticsAvailablePeriods() {
  const months = await getAnalyticsAvailableMonths()
  const currentYear = String(new Date().getFullYear())
  const years = Array.from(new Set([...months.map((month) => month.slice(0, 4)), currentYear]))
    .sort((left, right) => Number(right) - Number(left))

  return {
    months,
    years,
  }
}

function normalizePeriodMode(
  rawPeriod: string | undefined,
  rawTime: string | undefined
): AnalyticsPeriodMode {
  if (rawPeriod === "all" || rawPeriod === "monthly" || rawPeriod === "yearly") {
    return rawPeriod
  }

  if (rawTime === "period") {
    return "monthly"
  }

  return "yearly"
}

export function resolveAnalyticsFilter({
  query,
  availableMonths,
  availableYears,
}: {
  query: AnalyticsFilterQuery | undefined
  availableMonths: string[]
  availableYears: string[]
}): {
  mode: AnalyticsPeriodMode
  selectedMonth: string | null
  selectedYear: string | null
  fromDate: string | null
  toDate: string | null
} {
  const mode = normalizePeriodMode(query?.period, query?.time)
  const currentYear = String(new Date().getFullYear())
  const parsedMonth =
    toValidMonthInput(query?.month) ??
    (toValidDateInput(query?.from)?.slice(0, 7) ?? null)
  const parsedYear =
    toValidYearInput(query?.year) ??
    (parsedMonth ? parsedMonth.slice(0, 4) : currentYear)

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
