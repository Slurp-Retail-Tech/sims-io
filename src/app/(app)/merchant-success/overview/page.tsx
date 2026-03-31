import type { Metadata } from "next"

import { activeSupportRequestWhere } from "@/lib/analytics-ticket-filters"
import { queryWithReconnect } from "@/lib/db"
import { Card, CardContent, CardDescription, CardHeader } from "@/components/ui/card"

export const metadata: Metadata = {
  title: "Merchant Success Overview",
}

type CountRow = {
  total: number | string
}

type GroupRow = {
  name: string | null
  total: number | string
}

type TypeRow = {
  type: string | null
  total: number | string
}

type ActiveStatusRow = {
  open_total: number | string
  in_progress_total: number | string
  pending_customer_total: number | string
}

type BreakdownItem = {
  label: string
  value: number
}

type MetricItem = {
  label: string
  value: string
  delta: string
  breakdown?: BreakdownItem[]
}

function toNumber(value: number | string | null | undefined) {
  if (typeof value === "number") {
    return value
  }
  if (typeof value === "string") {
    return Number.parseInt(value, 10) || 0
  }
  return 0
}

function toGroupBreakdown(rows: GroupRow[]) {
  return rows.map((row) => ({
    label: row.name?.trim() || "Unassigned",
    value: toNumber(row.total),
  }))
}

function toTypeBreakdown(rows: TypeRow[]) {
  return rows.map((row) => ({
    label: row.type?.trim() || "Uncategorized",
    value: toNumber(row.total),
  }))
}

async function getOverviewMetrics() {
  try {
    const [activeStatusRows] = await queryWithReconnect<ActiveStatusRow[]>(
      `
      SELECT
        SUM(CASE WHEN status = 'Open' THEN 1 ELSE 0 END) AS open_total,
        SUM(CASE WHEN status = 'In Progress' THEN 1 ELSE 0 END) AS in_progress_total,
        SUM(CASE WHEN status = 'Pending Customer' THEN 1 ELSE 0 END) AS pending_customer_total
      FROM tickets
      WHERE ${activeSupportRequestWhere()}
    `
    )

    const [activeTicketRows] = await queryWithReconnect<CountRow[]>(
      `
      SELECT COUNT(*) AS total
      FROM tickets
      WHERE ${activeSupportRequestWhere()}
        AND status IN ('Open', 'In Progress', 'Pending Customer')
    `
    )

    const [newTodayRows] = await queryWithReconnect<CountRow[]>(
      `
      SELECT COUNT(*) AS total
      FROM tickets
      WHERE ${activeSupportRequestWhere()}
        AND DATE(COALESCE(opened_at, created_at)) = UTC_DATE()
    `
    )

    const [resolvedTodayRows] = await queryWithReconnect<CountRow[]>(
      `
      SELECT COUNT(*) AS total
      FROM tickets
      WHERE ${activeSupportRequestWhere()}
        AND status = 'Resolved'
        AND DATE(COALESCE(closed_at, updated_at)) = UTC_DATE()
    `
    )

    const [newYesterdayRows] = await queryWithReconnect<CountRow[]>(
      `
      SELECT COUNT(*) AS total
      FROM tickets
      WHERE ${activeSupportRequestWhere()}
        AND DATE(COALESCE(opened_at, created_at)) = UTC_DATE() - INTERVAL 1 DAY
    `
    )

    const [resolvedYesterdayRows] = await queryWithReconnect<CountRow[]>(
      `
      SELECT COUNT(*) AS total
      FROM tickets
      WHERE ${activeSupportRequestWhere()}
        AND status = 'Resolved'
        AND DATE(COALESCE(closed_at, updated_at)) = UTC_DATE() - INTERVAL 1 DAY
    `
    )

    const [workloadRows] = await queryWithReconnect<GroupRow[]>(
      `
      SELECT COALESCE(users.name, 'Unassigned') AS name, COUNT(*) AS total
      FROM tickets
      LEFT JOIN users
        ON users.id = tickets.ms_pic_user_id
      WHERE ${activeSupportRequestWhere()}
        AND tickets.status IN ('Open', 'In Progress')
      GROUP BY COALESCE(users.name, 'Unassigned')
      ORDER BY total DESC, name ASC
    `
    )

    const [pendingCustomerRows] = await queryWithReconnect<GroupRow[]>(
      `
      SELECT COALESCE(users.name, 'Unassigned') AS name, COUNT(*) AS total
      FROM tickets
      LEFT JOIN users
        ON users.id = tickets.ms_pic_user_id
      WHERE ${activeSupportRequestWhere()}
        AND tickets.status = 'Pending Customer'
      GROUP BY COALESCE(users.name, 'Unassigned')
      ORDER BY total DESC, name ASC
    `
    )

    const [resolvedByPicRows] = await queryWithReconnect<GroupRow[]>(
      `
      SELECT COALESCE(users.name, 'Unassigned') AS name, COUNT(*) AS total
      FROM tickets
      LEFT JOIN users
        ON users.id = tickets.ms_pic_user_id
      WHERE ${activeSupportRequestWhere()}
        AND tickets.status = 'Resolved'
        AND DATE(COALESCE(tickets.closed_at, tickets.updated_at)) = UTC_DATE()
      GROUP BY COALESCE(users.name, 'Unassigned')
      ORDER BY total DESC, name ASC
    `
    )

    const [ticketTypeRows] = await queryWithReconnect<TypeRow[]>(
      `
      SELECT issue_type AS type, COUNT(*) AS total
      FROM tickets
      WHERE ${activeSupportRequestWhere()}
        AND status IN ('Open', 'In Progress', 'Pending Customer')
      GROUP BY issue_type
      ORDER BY total DESC, type ASC
    `
    )

    const activeTickets = toNumber(activeTicketRows[0]?.total)
    const activeOpen = toNumber(activeStatusRows[0]?.open_total)
    const activeInProgress = toNumber(activeStatusRows[0]?.in_progress_total)
    const activePendingCustomer = toNumber(activeStatusRows[0]?.pending_customer_total)
    const newToday = toNumber(newTodayRows[0]?.total)
    const newYesterday = toNumber(newYesterdayRows[0]?.total)
    const newComparison = newToday - newYesterday
    const resolvedToday = toNumber(resolvedTodayRows[0]?.total)
    const resolvedYesterday = toNumber(resolvedYesterdayRows[0]?.total)
    const resolvedComparison = resolvedToday - resolvedYesterday
    const currentWorkload = workloadRows.reduce(
      (sum, row) => sum + toNumber(row.total),
      0
    )
    const pendingCustomer = pendingCustomerRows.reduce(
      (sum, row) => sum + toNumber(row.total),
      0
    )
    const resolvedByPic = resolvedByPicRows.reduce(
      (sum, row) => sum + toNumber(row.total),
      0
    )

    return {
      firstRow: [
        {
          label: "Active Tickets",
          value: String(activeTickets),
          delta: `Open: ${activeOpen} · In progress: ${activeInProgress} · Pending customer: ${activePendingCustomer}`,
        },
        {
          label: "New Tickets Today",
          value: String(newToday),
          delta: `${newComparison >= 0 ? `+${newComparison}` : newComparison} vs ${newYesterday} yesterday`,
        },
        {
          label: "Resolved Today",
          value: String(resolvedToday),
          delta: `${resolvedComparison >= 0 ? `+${resolvedComparison}` : resolvedComparison} vs ${resolvedYesterday} yesterday`,
        },
      ] satisfies MetricItem[],
      secondRow: [
        {
          label: "Current Workload by MS PIC",
          value: String(currentWorkload),
          delta: "Open and in progress by MS PIC",
          breakdown: toGroupBreakdown(workloadRows),
        },
        {
          label: "Pending Customer by MS PIC",
          value: String(pendingCustomer),
          delta: "Awaiting customer response by MS PIC",
          breakdown: toGroupBreakdown(pendingCustomerRows),
        },
        {
          label: "Resolved Today by MS PIC",
          value: String(resolvedByPic),
          delta: "Resolved today by MS PIC",
          breakdown: toGroupBreakdown(resolvedByPicRows),
        },
        {
          label: "Tickets by Type",
          value: `${ticketTypeRows.length} types`,
          delta: "Active ticket distribution by type",
          breakdown: toTypeBreakdown(ticketTypeRows),
        },
      ] satisfies MetricItem[],
    }
  } catch {
    return {
      firstRow: [
        {
          label: "Active Tickets",
          value: "0",
          delta: "Data unavailable",
        },
        {
          label: "New Tickets Today",
          value: "0",
          delta: "Data unavailable",
        },
        {
          label: "Resolved Today",
          value: "0",
          delta: "Data unavailable",
        },
      ] satisfies MetricItem[],
      secondRow: [
        {
          label: "Current Workload by MS PIC",
          value: "0",
          delta: "Data unavailable",
          breakdown: [],
        },
        {
          label: "Pending Customer by MS PIC",
          value: "0",
          delta: "Data unavailable",
          breakdown: [],
        },
        {
          label: "Resolved Today by MS PIC",
          value: "0",
          delta: "Data unavailable",
          breakdown: [],
        },
        {
          label: "Tickets by Type (Active · All Time)",
          value: "0 types",
          delta: "Data unavailable",
          breakdown: [],
        },
      ] satisfies MetricItem[],
    }
  }
}

export default async function MerchantSuccessOverviewPage() {
  const metrics = await getOverviewMetrics()

  return (
    <div className="animate-in fade-in slide-in-from-bottom-2 flex flex-col gap-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Merchant Success Overview
          </h1>
          <p className="text-muted-foreground text-sm">
            Live health of support queues and SLA performance.
          </p>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        {metrics.firstRow.map((item) => {
          return (
            <Card key={item.label} className="gap-2">
              <CardHeader className="pb-1">
                <CardDescription>{item.label}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-1">
                <div className="text-2xl font-semibold">{item.value}</div>
                <span className="block text-xs text-emerald-600 dark:text-emerald-400">
                  {item.delta}
                </span>
              </CardContent>
            </Card>
          )
        })}
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {metrics.secondRow.map((item) => {
          const breakdown = (item.breakdown ?? []).filter((entry) => entry.value > 0)
          const maxValue = breakdown.reduce(
            (max, entry) => (entry.value > max ? entry.value : max),
            0
          )
          return (
            <Card key={item.label} className="gap-2">
              <CardHeader className="pb-1">
                <CardDescription>{item.label}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="space-y-1">
                  <div className="text-2xl font-semibold">{item.value}</div>
                  <span className="block text-xs text-emerald-600 dark:text-emerald-400">
                    {item.delta}
                  </span>
                </div>
                {breakdown.length ? (
                  <div className="space-y-2">
                    {breakdown.map((entry) => {
                      const width = maxValue ? Math.max((entry.value / maxValue) * 100, 6) : 0
                      return (
                        <div key={entry.label} className="space-y-1">
                          <div className="flex items-center justify-between text-xs">
                            <span className="text-muted-foreground truncate pr-2">
                              {entry.label}
                            </span>
                            <span className="font-medium">{entry.value}</span>
                          </div>
                          <div className="bg-muted h-2 overflow-hidden rounded-full">
                            <div
                              className="h-full rounded-full bg-red-500"
                              style={{ width: `${width}%` }}
                            />
                          </div>
                        </div>
                      )
                    })}
                  </div>
                ) : (
                  <div className="text-muted-foreground text-xs">No breakdown data</div>
                )}
              </CardContent>
            </Card>
          )
        })}
      </div>
    </div>
  )
}
