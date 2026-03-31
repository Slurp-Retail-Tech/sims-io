import { NextRequest, NextResponse } from "next/server"
import * as XLSX from "xlsx"

import getPool from "@/lib/db"

export const dynamic = "force-dynamic"

type ExportFormat = "csv" | "xlsx"

type TicketExportRow = {
  "Ticket ID": string
  "Merchant Name": string
  "Franchise Name": string
  "Outlet Name": string
  "Phone Number": string
  FID: string
  OID: string
  "Merchant Sentiment": string
  "Issue Type": string
  "Issue Subcategory 1": string
  "Issue Subcategory 2": string
  "Issue Description": string
  "Ticket Notes": string
  "ClickUp Link": string
  "ClickUp Task ID": string
  "ClickUp Status": string
  "ClickUp Status Synced At": string
  Status: string
  "Closed By": string
  "Closed At": string
  "Opened At": string
  "Assigned MS PIC": string
  "Created At": string
  "CSAT Link Shared": string
  "CSAT Support Score": string
  "CSAT Support Comment": string
  "CSAT Product Score": string
  "CSAT Product Feedback": string
}

type ExportFilterContext = {
  query: string
  status: string | null
  archive: string | null
  clickup: string | null
  startDate: string | null
  endDate: string | null
}

const exportColumnOrder: Array<keyof TicketExportRow> = [
  "Ticket ID",
  "Merchant Name",
  "Franchise Name",
  "Outlet Name",
  "Phone Number",
  "FID",
  "OID",
  "Merchant Sentiment",
  "Issue Type",
  "Issue Subcategory 1",
  "Issue Subcategory 2",
  "Issue Description",
  "Ticket Notes",
  "ClickUp Link",
  "ClickUp Task ID",
  "ClickUp Status",
  "ClickUp Status Synced At",
  "Status",
  "Closed By",
  "Closed At",
  "Opened At",
  "Assigned MS PIC",
  "Created At",
  "CSAT Link Shared",
  "CSAT Support Score",
  "CSAT Support Comment",
  "CSAT Product Score",
  "CSAT Product Feedback",
]

function getNowToken() {
  const now = new Date()
  const pad = (value: number) => String(value).padStart(2, "0")
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(
    now.getHours()
  )}${pad(now.getMinutes())}${pad(now.getSeconds())}`
}

function formatExportDate(value: string | null) {
  if (!value) {
    return ""
  }
  const parsed = new Date(value.endsWith("Z") ? value : `${value}Z`)
  if (Number.isNaN(parsed.valueOf())) {
    return ""
  }
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
    timeZone: "Asia/Kuala_Lumpur",
  }).format(parsed)
}

function sanitizeValue(value: string | null | undefined) {
  return value?.trim() ?? ""
}

function toFilterRows(context: ExportFilterContext) {
  const dateRange = context.startDate
    ? context.endDate && context.endDate !== context.startDate
      ? `${context.startDate} to ${context.endDate}`
      : context.startDate
    : "All dates"

  return [
    ["Search Query", context.query || "All"],
    ["Status", context.status && context.status !== "all" ? context.status : "All"],
    [
      "Archive",
      context.archive === "archived"
        ? "Archived only"
        : context.archive === "active"
          ? "Active only"
          : "All",
    ],
    [
      "ClickUp",
      context.clickup === "with"
        ? "With task"
        : context.clickup === "without"
          ? "Without task"
          : "All",
    ],
    ["Date Range", dateRange],
  ] satisfies string[][]
}

export async function GET(request: NextRequest) {
  const userId = request.headers.get("x-user-id")?.trim()
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 })
  }

  const { searchParams } = new URL(request.url)
  const query = searchParams.get("q")?.trim().toLowerCase() ?? ""
  const status = searchParams.get("status")?.trim()
  const archive = searchParams.get("archive")?.trim()
  const clickup = searchParams.get("clickup")?.trim()
  const startDate = searchParams.get("start_date")?.trim()
  const endDate = searchParams.get("end_date")?.trim()
  const format = (searchParams.get("format")?.trim().toLowerCase() ?? "csv") as ExportFormat

  if (!["csv", "xlsx"].includes(format)) {
    return NextResponse.json({ error: "Invalid format." }, { status: 400 })
  }

  const filterContext: ExportFilterContext = {
    query,
    status: status ?? null,
    archive: archive ?? null,
    clickup: clickup ?? null,
    startDate: startDate ?? null,
    endDate: endDate ?? null,
  }

  const whereClauses: string[] = []
  const values: Array<string | number> = []

  if (query) {
    const likeValue = `%${query}%`
    whereClauses.push(
      `(LOWER(tickets.merchant_name) LIKE ? OR LOWER(tickets.phone_number) LIKE ? OR LOWER(tickets.franchise_name_resolved) LIKE ? OR LOWER(tickets.outlet_name_resolved) LIKE ? OR LOWER(tickets.fid) LIKE ? OR LOWER(tickets.oid) LIKE ? OR LOWER(tickets.issue_type) LIKE ? OR LOWER(tickets.issue_subcategory1) LIKE ? OR LOWER(tickets.issue_subcategory2) LIKE ?)`
    )
    values.push(
      likeValue,
      likeValue,
      likeValue,
      likeValue,
      likeValue,
      likeValue,
      likeValue,
      likeValue,
      likeValue
    )
  }

  if (status && status !== "all") {
    whereClauses.push("tickets.status = ?")
    values.push(status)
  }

  if (archive === "active") {
    whereClauses.push("tickets.hidden = FALSE")
  } else if (archive === "archived") {
    whereClauses.push("tickets.hidden = TRUE")
  }

  if (clickup === "with") {
    whereClauses.push(
      `(
        (tickets.clickup_task_id IS NOT NULL AND tickets.clickup_task_id <> '')
        OR (tickets.clickup_link IS NOT NULL AND tickets.clickup_link <> '')
      )`
    )
  } else if (clickup === "without") {
    whereClauses.push(
      `(
        (tickets.clickup_task_id IS NULL OR tickets.clickup_task_id = '')
        AND (tickets.clickup_link IS NULL OR tickets.clickup_link = '')
      )`
    )
  }

  if (startDate) {
    whereClauses.push("DATE(COALESCE(tickets.opened_at, tickets.created_at)) >= ?")
    values.push(startDate)
  }

  if (endDate) {
    whereClauses.push("DATE(COALESCE(tickets.opened_at, tickets.created_at)) <= ?")
    values.push(endDate)
  }

  const whereSql = whereClauses.length
    ? `WHERE ${whereClauses.join(" AND ")}`
    : ""

  const pool = getPool()
  const [rows] = await pool.query(
    `
    SELECT
      tickets.id,
      tickets.merchant_name,
      tickets.franchise_name_resolved,
      tickets.outlet_name_resolved,
      tickets.phone_number,
      tickets.fid,
      tickets.oid,
      tickets.issue_type,
      tickets.issue_subcategory1,
      tickets.issue_subcategory2,
      tickets.issue_description,
      tickets.ticket_description,
      tickets.clickup_link,
      tickets.clickup_task_id,
      tickets.clickup_task_status,
      tickets.clickup_task_status_synced_at,
      tickets.status,
      tickets.updated_by,
      tickets.closed_at,
      tickets.opened_at,
      tickets.merchant_sentiment,
      tickets.created_at,
      users.name AS assigned_ms_pic,
      CASE
        WHEN csat_sent.ticket_id IS NULL THEN FALSE
        ELSE TRUE
      END AS csat_link_shared,
      csat.support_score AS csat_support_score,
      csat.support_reason AS csat_support_comment,
      csat.product_score AS csat_product_score,
      csat.product_feedback AS csat_product_feedback
    FROM tickets
    LEFT JOIN users
      ON users.id = tickets.ms_pic_user_id
    LEFT JOIN csat_tokens
      ON csat_tokens.ticket_id = tickets.id
      AND csat_tokens.id = (
        SELECT MAX(tokens.id)
        FROM csat_tokens AS tokens
        WHERE tokens.ticket_id = tickets.id
      )
    LEFT JOIN (
      SELECT latest.*
      FROM csat_responses AS latest
      INNER JOIN (
        SELECT ticket_id, MAX(id) AS max_id
        FROM csat_responses
        GROUP BY ticket_id
      ) grouped
        ON grouped.max_id = latest.id
    ) csat
      ON csat.ticket_id = tickets.id
    LEFT JOIN (
      SELECT ticket_id
      FROM ticket_history
      WHERE field_name IN ('csat_link_shared', 'csat_link_shared_at')
      GROUP BY ticket_id
    ) csat_sent
      ON csat_sent.ticket_id = tickets.id
    ${whereSql}
    ORDER BY tickets.created_at DESC
  `,
    values
  )

  const exportRows: TicketExportRow[] = (rows as Array<Record<string, unknown>>).map(
    (row) => ({
      "Ticket ID": sanitizeValue(String(row.id ?? "")),
      "Merchant Name": sanitizeValue(row.merchant_name as string | null),
      "Franchise Name": sanitizeValue(
        row.franchise_name_resolved as string | null
      ),
      "Outlet Name": sanitizeValue(row.outlet_name_resolved as string | null),
      "Phone Number": sanitizeValue(row.phone_number as string | null),
      FID: sanitizeValue(row.fid as string | null),
      OID: sanitizeValue(row.oid as string | null),
      "Merchant Sentiment": sanitizeValue(row.merchant_sentiment as string | null),
      "Issue Type": sanitizeValue(row.issue_type as string | null),
      "Issue Subcategory 1": sanitizeValue(
        row.issue_subcategory1 as string | null
      ),
      "Issue Subcategory 2": sanitizeValue(
        row.issue_subcategory2 as string | null
      ),
      "Issue Description": sanitizeValue(row.issue_description as string | null),
      "Ticket Notes": sanitizeValue(row.ticket_description as string | null),
      "ClickUp Link": sanitizeValue(row.clickup_link as string | null),
      "ClickUp Task ID": sanitizeValue(row.clickup_task_id as string | null),
      "ClickUp Status": sanitizeValue(row.clickup_task_status as string | null),
      "ClickUp Status Synced At": formatExportDate(
        (row.clickup_task_status_synced_at as string | null) ?? null
      ),
      Status: sanitizeValue(row.status as string | null),
      "Closed By": sanitizeValue(row.updated_by as string | null),
      "Closed At": formatExportDate((row.closed_at as string | null) ?? null),
      "Opened At": formatExportDate((row.opened_at as string | null) ?? null),
      "Assigned MS PIC": sanitizeValue(row.assigned_ms_pic as string | null),
      "Created At": formatExportDate((row.created_at as string | null) ?? null),
      "CSAT Link Shared": row.csat_link_shared ? "True" : "False",
      "CSAT Support Score": sanitizeValue(row.csat_support_score as string | null),
      "CSAT Support Comment": sanitizeValue(
        row.csat_support_comment as string | null
      ),
      "CSAT Product Score": sanitizeValue(row.csat_product_score as string | null),
      "CSAT Product Feedback": sanitizeValue(
        row.csat_product_feedback as string | null
      ),
    })
  )

  const tableRows: string[][] = [
    ["Filter", "Value"],
    ...toFilterRows(filterContext),
    [],
    exportColumnOrder as string[],
    ...exportRows.map((row) => exportColumnOrder.map((key) => row[key])),
  ]

  const baseName = `tickets-export-${getNowToken()}`

  if (format === "xlsx") {
    const workbook = XLSX.utils.book_new()
    const worksheet = XLSX.utils.aoa_to_sheet(tableRows)
    XLSX.utils.book_append_sheet(workbook, worksheet, "Tickets")

    const buffer = XLSX.write(workbook, {
      type: "buffer",
      bookType: "xlsx",
    }) as Buffer

    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${baseName}.xlsx"`,
      },
    })
  }

  const csv = XLSX.utils.sheet_to_csv(XLSX.utils.aoa_to_sheet(tableRows))
  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${baseName}.csv"`,
    },
  })
}
