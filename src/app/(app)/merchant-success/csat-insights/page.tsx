import type { Metadata } from "next"
import { cookies } from "next/headers"

import { activeSupportRequestWhere } from "@/lib/analytics-ticket-filters"
import { localSqlDate } from "@/lib/app-timezone"
import { queryWithReconnect } from "@/lib/db"
import { formatDateTime } from "@/lib/dates"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Separator } from "@/components/ui/separator"
import {
  getAnalyticsAvailablePeriods,
  resolveAnalyticsFilter,
  toValidDateInput,
} from "../analytics/data"
import {
  ANALYTICS_FILTER_COOKIE_NAME,
  parseAnalyticsFilterCookie,
  type AnalyticsPeriodMode,
} from "../analytics/filter-state"
import { CsatInsightsHeaderFilters } from "./header-filters"

export const metadata: Metadata = {
  title: "Merchant Success CSAT Insights",
}

type CountRow = {
  total: number | string
}

type SatisfactionRow = {
  support_satisfaction: number | string | null
  product_satisfaction: number | string | null
}

type BreakdownRow = {
  score_label: string
  total: number | string
}

type FeedbackRow = {
  ticket_id: number | string
  merchant_name: string | null
  outlet_name_resolved: string | null
  support_reason: string | null
  product_feedback: string | null
  submitted_at: string
}

type BreakdownItem = {
  label: string
  value: number
  percentage: number
}

const RATING_ORDER = ["4", "3", "2", "1"] as const

const SCORE_CASE_SQL = `
  CASE
    WHEN LOWER(TRIM(%COLUMN%)) IN ('very satisfied', 'sangat puas hati') THEN 4
    WHEN LOWER(TRIM(%COLUMN%)) IN ('satisfied', 'puas hati') THEN 3
    WHEN LOWER(TRIM(%COLUMN%)) IN ('neutral', 'berkecuali') THEN 2
    WHEN LOWER(TRIM(%COLUMN%)) IN ('dissatisfied', 'tidak berpuas hati') THEN 1
    WHEN TRIM(%COLUMN%) REGEXP '^[1-5]$' THEN CAST(TRIM(%COLUMN%) AS UNSIGNED)
    ELSE NULL
  END
`

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

function toPercentage(part: number, total: number) {
  if (total <= 0) {
    return 0
  }
  return (part / total) * 100
}

function formatScore(value: number) {
  if (!Number.isFinite(value) || value <= 0) {
    return "-"
  }
  return `${value.toFixed(2)} / 4`
}

function toScoreLabel(scoreLabel: string) {
  switch (scoreLabel) {
    case "4":
      return "Very satisfied"
    case "3":
      return "Satisfied"
    case "2":
      return "Neutral"
    case "1":
      return "Dissatisfied"
    default:
      return "Unrated"
  }
}

function toBreakdownRows(rows: BreakdownRow[]) {
  const counts = new Map<string, number>()
  rows.forEach((row) => {
    counts.set(row.score_label, toNumber(row.total))
  })

  const total = RATING_ORDER.reduce(
    (sum, rating) => sum + (counts.get(rating) ?? 0),
    0
  )

  return RATING_ORDER.map((rating) => {
    const value = counts.get(rating) ?? 0
    return {
      label: toScoreLabel(rating),
      value,
      percentage: toPercentage(value, total),
    }
  })
}

function buildDateWhereClause(
  column: string,
  fromDate: string | null,
  toDate: string | null
) {
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

  if (!clauses.length) {
    return { sql: "", values }
  }

  return {
    sql: ` AND ${clauses.join(" AND ")}`,
    values,
  }
}

async function getCsatInsights({
  mode,
  fromDate,
  toDate,
}: {
  mode: AnalyticsPeriodMode
  fromDate: string | null
  toDate: string | null
}) {
  try {
    const applyPeriod = mode !== "all"
    const responseDateFilter = applyPeriod
      ? buildDateWhereClause("csat_responses.submitted_at", fromDate, toDate)
      : { sql: "", values: [] as string[] }
    const sentDateFilter = applyPeriod
      ? buildDateWhereClause("ticket_history.changed_at", fromDate, toDate)
      : { sql: "", values: [] as string[] }

    const [responseRows] = await queryWithReconnect<CountRow[]>(
      `
      SELECT COUNT(*) AS total
      FROM csat_responses
      INNER JOIN tickets
        ON tickets.id = csat_responses.ticket_id
      WHERE ${activeSupportRequestWhere()}
      ${responseDateFilter.sql}
    `,
      responseDateFilter.values
    )

    const [sentLinkRows] = await queryWithReconnect<CountRow[]>(
      `
      SELECT COUNT(*) AS total
      FROM (
        SELECT DISTINCT ticket_history.ticket_id
        FROM ticket_history
        INNER JOIN tickets
          ON tickets.id = ticket_history.ticket_id
        WHERE ${activeSupportRequestWhere()}
          AND ticket_history.field_name IN (
            'csat_link_shared',
            'csat_link_shared_at'
          )
          ${sentDateFilter.sql}
      ) AS sent_links
    `,
      sentDateFilter.values
    )

    const [satisfactionRows] = await queryWithReconnect<SatisfactionRow[]>(
      `
      SELECT
        AVG(${SCORE_CASE_SQL.replace(/%COLUMN%/g, "support_score")}) AS support_satisfaction,
        AVG(${SCORE_CASE_SQL.replace(/%COLUMN%/g, "product_score")}) AS product_satisfaction
      FROM csat_responses
      INNER JOIN tickets
        ON tickets.id = csat_responses.ticket_id
      WHERE ${activeSupportRequestWhere()}
      ${responseDateFilter.sql}
    `,
      responseDateFilter.values
    )

    const [supportBreakdownRows] = await queryWithReconnect<BreakdownRow[]>(
      `
      SELECT
        CAST(${SCORE_CASE_SQL.replace(/%COLUMN%/g, "support_score")} AS CHAR) AS score_label,
        COUNT(*) AS total
      FROM csat_responses
      INNER JOIN tickets
        ON tickets.id = csat_responses.ticket_id
      WHERE ${activeSupportRequestWhere()}
      ${responseDateFilter.sql}
      GROUP BY score_label
      ORDER BY score_label DESC
    `,
      responseDateFilter.values
    )

    const [productBreakdownRows] = await queryWithReconnect<BreakdownRow[]>(
      `
      SELECT
        CAST(${SCORE_CASE_SQL.replace(/%COLUMN%/g, "product_score")} AS CHAR) AS score_label,
        COUNT(*) AS total
      FROM csat_responses
      INNER JOIN tickets
        ON tickets.id = csat_responses.ticket_id
      WHERE ${activeSupportRequestWhere()}
      ${responseDateFilter.sql}
      GROUP BY score_label
      ORDER BY score_label DESC
    `,
      responseDateFilter.values
    )

    const [feedbackRows] = await queryWithReconnect<FeedbackRow[]>(
      `
      SELECT
        csat_responses.ticket_id,
        tickets.merchant_name,
        tickets.outlet_name_resolved,
        csat_responses.support_reason,
        csat_responses.product_feedback,
        csat_responses.submitted_at
      FROM csat_responses
      INNER JOIN tickets
        ON tickets.id = csat_responses.ticket_id
      WHERE ${activeSupportRequestWhere()}
      ${responseDateFilter.sql}
        AND (
          (csat_responses.support_reason IS NOT NULL
            AND TRIM(csat_responses.support_reason) <> '')
          OR
          (csat_responses.product_feedback IS NOT NULL
            AND TRIM(csat_responses.product_feedback) <> '')
        )
      ORDER BY csat_responses.submitted_at DESC
      LIMIT 8
    `,
      responseDateFilter.values
    )

    const totalResponses = toNumber(responseRows[0]?.total)
    const sentLinks = toNumber(sentLinkRows[0]?.total)
    const responseRate = toPercentage(totalResponses, sentLinks)

    const supportSatisfaction = toNumber(satisfactionRows[0]?.support_satisfaction)
    const productSatisfaction = toNumber(satisfactionRows[0]?.product_satisfaction)

    const supportBreakdown = toBreakdownRows(supportBreakdownRows)
    const productBreakdown = toBreakdownRows(productBreakdownRows)

    return {
      totalResponses,
      sentLinks,
      responseRate,
      supportSatisfaction,
      productSatisfaction,
      supportBreakdown,
      productBreakdown,
      feedbackRows,
    }
  } catch {
    return {
      totalResponses: 0,
      sentLinks: 0,
      responseRate: 0,
      supportSatisfaction: 0,
      productSatisfaction: 0,
      supportBreakdown: [] as BreakdownItem[],
      productBreakdown: [] as BreakdownItem[],
      feedbackRows: [] as FeedbackRow[],
    }
  }
}

function BreakdownCard({
  title,
  description,
  rows,
}: {
  title: string
  description: string
  rows: BreakdownItem[]
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {rows.length ? (
          rows.map((row) => (
            <div key={row.label} className="space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span>{row.label}</span>
                <span className="text-muted-foreground">
                  {row.value} ({row.percentage.toFixed(1)}%)
                </span>
              </div>
              <div className="bg-muted/70 h-1.5 rounded-full">
                <div
                  className="bg-primary h-1.5 rounded-full"
                  style={{ width: `${Math.min(row.percentage, 100)}%` }}
                />
              </div>
            </div>
          ))
        ) : (
          <p className="text-sm text-muted-foreground">No CSAT responses yet.</p>
        )}
      </CardContent>
    </Card>
  )
}

export default async function MerchantSuccessCsatInsightsPage({
  searchParams,
}: {
  searchParams?: Promise<{
    period?: string
    time?: string
    month?: string
    year?: string
    from?: string
    to?: string
  }>
}) {
  const params = searchParams ? await searchParams : undefined
  const cookieStore = await cookies()
  const persistedFilter = parseAnalyticsFilterCookie(
    cookieStore.get(ANALYTICS_FILTER_COOKIE_NAME)?.value
  )
  const { months: monthOptions, years: yearOptions } =
    await getAnalyticsAvailablePeriods()

  const { mode, selectedMonth, selectedYear, fromDate, toDate } =
    resolveAnalyticsFilter({
      query: {
        period: params?.period ?? persistedFilter?.period,
        time: params?.time,
        month: params?.month ?? persistedFilter?.month,
        year: params?.year ?? persistedFilter?.year,
        from: toValidDateInput(params?.from) ?? undefined,
      },
      availableMonths: monthOptions,
      availableYears: yearOptions,
    })

  const data = await getCsatInsights({
    mode,
    fromDate,
    toDate,
  })

  return (
    <div className="animate-in fade-in slide-in-from-bottom-2 flex flex-col gap-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">CSAT Insights</h1>
          <p className="text-muted-foreground text-sm">
            Merchant Success satisfaction and feedback performance.
          </p>
        </div>
        <CsatInsightsHeaderFilters
          mode={mode}
          selectedMonth={selectedMonth}
          selectedYear={selectedYear}
          monthOptions={monthOptions}
          yearOptions={yearOptions}
        />
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Total CSAT Responses</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-semibold">{data.totalResponses}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Response Rate</CardTitle>
            <CardDescription>Based on sent links</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-semibold">{data.responseRate.toFixed(1)}%</div>
            <p className="text-muted-foreground mt-1 text-xs">
              {data.totalResponses} responses / {data.sentLinks} sent links
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Support Satisfaction</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-semibold">
              {formatScore(data.supportSatisfaction)}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Product Satisfaction</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-semibold">
              {formatScore(data.productSatisfaction)}
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <BreakdownCard
          title="Support Response Breakdown"
          description="Distribution of support satisfaction ratings"
          rows={data.supportBreakdown}
        />
        <BreakdownCard
          title="Product Response Breakdown"
          description="Distribution of product satisfaction ratings"
          rows={data.productBreakdown}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Customer Feedback</CardTitle>
          <CardDescription>Most recent comments from CSAT submissions</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {data.feedbackRows.length ? (
            data.feedbackRows.map((row, index) => (
              <div key={`${row.ticket_id}-${row.submitted_at}`} className="space-y-3">
                <div className="space-y-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="text-sm font-semibold">
                      #{row.ticket_id} - {(row.merchant_name?.trim() || "Merchant")} -{" "}
                      {row.outlet_name_resolved?.trim() || "Outlet"}
                    </div>
                    <div className="text-muted-foreground text-xs">
                      {formatDateTime(row.submitted_at)}
                    </div>
                  </div>
                  {row.support_reason?.trim() ? (
                    <p className="text-sm">
                      <span className="font-medium">Support:</span>{" "}
                      {row.support_reason}
                    </p>
                  ) : null}
                  {row.product_feedback?.trim() ? (
                    <p className="text-sm">
                      <span className="font-medium">Product:</span>{" "}
                      {row.product_feedback}
                    </p>
                  ) : null}
                </div>
                {index < data.feedbackRows.length - 1 ? <Separator /> : null}
              </div>
            ))
          ) : (
            <p className="text-sm text-muted-foreground">
              No customer feedback submitted yet.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
