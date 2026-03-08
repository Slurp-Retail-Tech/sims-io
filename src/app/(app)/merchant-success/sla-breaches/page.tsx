import type { Metadata } from "next"
import { SquareArrowOutUpRight } from "lucide-react"

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { formatDateTime, parseDate } from "@/lib/dates"
import { queryWithReconnect } from "@/lib/db"

export const metadata: Metadata = {
  title: "Merchant Success - SLA Breaches",
}

type SlaBreachRow = {
  id: string
  customer_name: string | null
  customer_phone: string | null
  franchise_name: string | null
  outlet_name: string | null
  fid: string | null
  oid: string | null
  status: string
  category: string | null
  subcategory_1: string | null
  subcategory_2: string | null
  clickup_link: string | null
  clickup_task_id: string | null
  clickup_task_status: string | null
  created_at: string
  ms_agent_name: string | null
}

type TicketRow = {
  id: string
  customerName: string | null
  customerPhone: string | null
  franchiseName: string | null
  outletName: string | null
  fid: string | null
  oid: string | null
  status: string
  category: string | null
  subcategory1: string | null
  subcategory2: string | null
  clickupLink: string | null
  clickupTaskId: string | null
  clickupTaskStatus: string | null
  createdAt: string
  msAgentName: string | null
}

const statusColorMap: Record<string, { text: string; background: string }> = {
  Open: {
    text: "#b91c1c",
    background: "rgba(185, 28, 28, 0.12)",
  },
  "In Progress": {
    text: "#d97706",
    background: "rgba(217, 119, 6, 0.12)",
  },
  "Pending Customer": {
    text: "#0ea5e9",
    background: "rgba(14, 165, 233, 0.14)",
  },
  Resolved: {
    text: "#047857",
    background: "rgba(4, 120, 87, 0.12)",
  },
}

function getTicketStatusColors(status: string) {
  return (
    statusColorMap[status] ?? {
      text: "#374151",
      background: "rgba(55, 65, 81, 0.12)",
    }
  )
}

function getClickUpStatusColors(status: string | null) {
  const normalized = (status ?? "").trim().toLowerCase()
  if (!normalized || normalized === "unknown") {
    return { text: "#374151", background: "rgba(55, 65, 81, 0.12)" }
  }
  if (
    normalized.includes("done") ||
    normalized.includes("closed") ||
    normalized.includes("complete") ||
    normalized.includes("resolved")
  ) {
    return { text: "#047857", background: "rgba(4, 120, 87, 0.12)" }
  }
  if (
    normalized.includes("progress") ||
    normalized.includes("review") ||
    normalized.includes("working")
  ) {
    return { text: "#d97706", background: "rgba(217, 119, 6, 0.12)" }
  }
  if (
    normalized.includes("todo") ||
    normalized.includes("open") ||
    normalized.includes("backlog")
  ) {
    return { text: "#0ea5e9", background: "rgba(14, 165, 233, 0.14)" }
  }
  if (normalized.includes("blocked") || normalized.includes("stuck")) {
    return { text: "#b91c1c", background: "rgba(185, 28, 28, 0.12)" }
  }
  return { text: "#374151", background: "rgba(55, 65, 81, 0.12)" }
}

function toProperCase(value: string | null) {
  if (!value) {
    return "Unknown"
  }
  return value
    .trim()
    .replace(/[_-]+/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(" ")
}

function formatAge(createdAt: string, now: Date) {
  const created = parseDate(createdAt)
  if (!created) {
    return "--"
  }

  const diffMs = now.getTime() - created.getTime()
  if (diffMs <= 0) {
    return "0h"
  }

  const totalHours = Math.floor(diffMs / (1000 * 60 * 60))
  const days = Math.floor(totalHours / 24)
  const hours = totalHours % 24

  if (days <= 0) {
    return `${hours}h`
  }

  if (hours === 0) {
    return `${days}d`
  }

  return `${days}d ${hours}h`
}

async function getSlaBreaches() {
  const [rows] = await queryWithReconnect<SlaBreachRow[]>(
    `
      SELECT
        support_requests.id,
        support_requests.merchant_name AS customer_name,
        support_requests.phone_number AS customer_phone,
        support_requests.franchise_name_resolved AS franchise_name,
        support_requests.outlet_name_resolved AS outlet_name,
        support_requests.fid,
        support_requests.oid,
        support_requests.status,
        support_requests.issue_type AS category,
        support_requests.issue_subcategory1 AS subcategory_1,
        support_requests.issue_subcategory2 AS subcategory_2,
        support_requests.clickup_link,
        support_requests.clickup_task_id,
        support_requests.clickup_task_status,
        support_requests.created_at,
        users.name AS ms_agent_name
      FROM support_requests
      LEFT JOIN users
        ON users.id = support_requests.ms_pic_user_id
      WHERE support_requests.hidden = FALSE
        AND support_requests.status <> 'Resolved'
        AND support_requests.created_at <= UTC_TIMESTAMP() - INTERVAL 3 DAY
      ORDER BY support_requests.created_at ASC, support_requests.id ASC
    `
  )

  const tickets = rows.map((row) => ({
    id: row.id,
    customerName: row.customer_name,
    customerPhone: row.customer_phone,
    franchiseName: row.franchise_name,
    outletName: row.outlet_name,
    fid: row.fid,
    oid: row.oid,
    status: row.status,
    category: row.category,
    subcategory1: row.subcategory_1,
    subcategory2: row.subcategory_2,
    clickupLink: row.clickup_link,
    clickupTaskId: row.clickup_task_id,
    clickupTaskStatus: row.clickup_task_status,
    createdAt: row.created_at,
    msAgentName: row.ms_agent_name,
  }))

  return {
    withClickup: tickets.filter(
      (ticket) => Boolean(ticket.clickupTaskId || ticket.clickupLink)
    ),
    withoutClickup: tickets.filter(
      (ticket) => !ticket.clickupTaskId && !ticket.clickupLink
    ),
  }
}

function SlaTable({
  title,
  description,
  tickets,
  now,
}: {
  title: string
  description: string
  tickets: TicketRow[]
  now: Date
}) {
  return (
    <div className="overflow-x-auto rounded-lg border bg-card">
      <div className="flex items-center justify-between border-b px-4 py-3">
        <div className="text-base font-semibold">{title}</div>
        <div className="text-xs text-muted-foreground">
          {tickets.length} ticket{tickets.length === 1 ? "" : "s"}
        </div>
      </div>
      <table className="w-full text-sm">
        <thead className="bg-muted/50 text-left text-xs font-semibold text-muted-foreground">
          <tr>
            <th className="px-4 py-3">ID</th>
            <th className="px-4 py-3">Merchant / Outlet</th>
            <th className="px-4 py-3">Contact</th>
            <th className="px-4 py-3">FID / OID</th>
            <th className="px-4 py-3">Issue</th>
            <th className="px-4 py-3">ClickUp</th>
            <th className="px-4 py-3">Status</th>
            <th className="px-4 py-3">Created</th>
            <th className="px-4 py-3">Open For</th>
          </tr>
        </thead>
        <tbody>
          {tickets.length ? (
            tickets.map((ticket, index) => {
              const statusColors = getTicketStatusColors(ticket.status)
              const clickupStatusColors = getClickUpStatusColors(
                ticket.clickupTaskStatus
              )
              const hasClickUpTask = Boolean(
                ticket.clickupTaskId || ticket.clickupLink
              )

              return (
                <tr
                  key={ticket.id}
                  className={index % 2 === 0 ? "bg-background" : "bg-muted/20"}
                >
                  <td className="px-4 py-3 font-medium">#{ticket.id}</td>
                  <td className="px-4 py-3">
                    <div className="font-semibold">
                      {ticket.franchiseName ?? "--"}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {ticket.outletName ?? "--"}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="font-semibold">
                      {ticket.customerName ?? "--"}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {ticket.customerPhone ?? "--"}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-xs">
                    {ticket.fid ? (
                      <a
                        className="font-semibold text-rose-700 hover:underline dark:text-rose-300"
                        href={`https://cloud.getslurp.com/batcave/franchise/${encodeURIComponent(ticket.fid)}`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        <span className="inline-flex items-center gap-1">
                          {ticket.fid}
                          <SquareArrowOutUpRight className="size-3" aria-hidden="true" />
                        </span>
                      </a>
                    ) : (
                      <span className="font-semibold text-muted-foreground">--</span>
                    )}
                    <br />
                    <span className="text-muted-foreground">
                      {ticket.oid ?? "--"}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-xs">
                    <div>{ticket.category ?? "--"}</div>
                    <div className="text-muted-foreground">
                      {ticket.subcategory1 ?? "--"}
                      {ticket.subcategory2 ? ` · ${ticket.subcategory2}` : ""}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-xs">
                    {hasClickUpTask ? (
                      <div className="space-y-1">
                        {ticket.clickupLink ? (
                          <a
                            className="font-medium text-primary hover:underline"
                            href={ticket.clickupLink}
                            target="_blank"
                            rel="noreferrer"
                          >
                            <span className="inline-flex items-center gap-1">
                              {ticket.clickupTaskId ?? "Open task"}
                              <SquareArrowOutUpRight className="size-3" aria-hidden="true" />
                            </span>
                          </a>
                        ) : (
                          <div className="font-medium">
                            {ticket.clickupTaskId ?? "Open task"}
                          </div>
                        )}
                        <span
                          className="inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-semibold"
                          style={{
                            color: clickupStatusColors.text,
                            backgroundColor: clickupStatusColors.background,
                          }}
                        >
                          {toProperCase(ticket.clickupTaskStatus)}
                        </span>
                      </div>
                    ) : (
                      <span className="text-muted-foreground">--</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className="inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-semibold whitespace-nowrap"
                      style={{
                        color: statusColors.text,
                        backgroundColor: statusColors.background,
                      }}
                    >
                      <span
                        className="size-2 rounded-full"
                        style={{ backgroundColor: statusColors.text }}
                      />
                      {ticket.status}
                    </span>
                    {ticket.msAgentName ? (
                      <div className="mt-2 text-xs text-muted-foreground">
                        {ticket.msAgentName}
                      </div>
                    ) : null}
                  </td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">
                    {formatDateTime(ticket.createdAt)}
                  </td>
                  <td className="px-4 py-3 text-xs font-medium">
                    {formatAge(ticket.createdAt, now)}
                  </td>
                </tr>
              )
            })
          ) : (
            <tr>
              <td
                colSpan={9}
                className="px-4 py-8 text-center text-sm text-muted-foreground"
              >
                {description}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  )
}

export default async function MerchantSuccessSlaBreachesPage() {
  const { withClickup, withoutClickup } = await getSlaBreaches()
  const totalBreaches = withClickup.length + withoutClickup.length
  const now = new Date()

  return (
    <div className="animate-in fade-in slide-in-from-bottom-2 flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          Merchant Success SLA Breaches
        </h1>
        <p className="text-muted-foreground text-sm">
          Unresolved tickets created more than 3 days ago.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Total breached tickets</CardDescription>
            <CardTitle className="text-3xl">{totalBreaches}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>With ClickUp task</CardDescription>
            <CardTitle className="text-3xl">{withClickup.length}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Without ClickUp task</CardDescription>
            <CardTitle className="text-3xl">{withoutClickup.length}</CardTitle>
          </CardHeader>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>SLA breach queue</CardTitle>
          <CardDescription>
            Tickets are split by ClickUp linkage so operational follow-up is clearer.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <SlaTable
            title="Breached tickets without ClickUp task"
            description="No breached tickets without a linked ClickUp task."
            tickets={withoutClickup}
            now={now}
          />
          <SlaTable
            title="Breached tickets with ClickUp task"
            description="No breached tickets with a linked ClickUp task."
            tickets={withClickup}
            now={now}
          />
        </CardContent>
      </Card>
    </div>
  )
}
