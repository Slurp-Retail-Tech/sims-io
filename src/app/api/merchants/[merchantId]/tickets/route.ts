import { NextRequest, NextResponse } from "next/server"

import getPool from "@/lib/db"
import { requireAuthenticatedUser } from "@/lib/auth"

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ merchantId: string }> }
) {
  const user = await requireAuthenticatedUser(request)
  if (!user) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 })
  }

  const { merchantId: merchantFid } = await context.params
  const { searchParams } = new URL(request.url)
  const outletId = searchParams.get("outlet_id")?.trim() ?? ""
  const pageParam = Number(searchParams.get("page") ?? "1")
  const perPageParam = Number(searchParams.get("per_page") ?? "10")
  const allowedPerPage = new Set([10, 25, 50, 100])
  const page = Number.isFinite(pageParam) && pageParam > 0 ? pageParam : 1
  const perPage = allowedPerPage.has(perPageParam) ? perPageParam : 10
  const offset = (page - 1) * perPage
  const pool = getPool()

  const [merchantRows] = await pool.query(
    `
    SELECT id, fid
    FROM merchants
    WHERE fid = ?
    LIMIT 1
  `,
    [merchantFid]
  )

  const merchant = (merchantRows as Array<{ id: string; fid: string | null }>)[0]
  if (!merchant) {
    return NextResponse.json({ error: "Merchant not found." }, { status: 404 })
  }

  if (!merchant.fid) {
    return NextResponse.json({ tickets: [], total: 0, page, perPage })
  }

  const whereClauses = ["tickets.fid = ?"]
  const values: Array<string | number> = [merchant.fid]

  if (outletId) {
    whereClauses.push("tickets.oid = ?")
    values.push(outletId)
  }

  const whereSql = `WHERE ${whereClauses.join(" AND ")}`

  const [countRows] = await pool.query(
    `
    SELECT COUNT(*) AS total
    FROM tickets
    ${whereSql}
  `,
    values
  )

  const totalValue =
    (countRows as Array<{ total: number | string }>)[0]?.total ?? 0
  const total =
    typeof totalValue === "string" ? Number.parseInt(totalValue, 10) : totalValue

  const [rows] = await pool.query(
    `
    SELECT
      tickets.id,
      tickets.merchant_name AS customer_name,
      tickets.phone_number AS customer_phone,
      tickets.franchise_name_resolved AS franchise_name,
      tickets.outlet_name_resolved AS outlet_name,
      tickets.fid,
      tickets.oid,
      tickets.status,
      tickets.hidden,
      tickets.issue_type AS category,
      tickets.issue_subcategory1 AS subcategory_1,
      tickets.issue_subcategory2 AS subcategory_2,
      tickets.clickup_link,
      tickets.clickup_task_id,
      tickets.clickup_task_status,
      COALESCE(tickets.closed_at, tickets.updated_at) AS resolved_at,
      tickets.created_at,
      tickets.updated_at AS last_message_at,
      users.name AS ms_agent_name
    FROM tickets
    LEFT JOIN users
      ON users.id = tickets.ms_pic_user_id
    ${whereSql}
    ORDER BY tickets.created_at DESC
    LIMIT ? OFFSET ?
  `,
    [...values, perPage, offset]
  )

  const tickets = (rows as Array<{
    id: string
    customer_name: string | null
    customer_phone: string | null
    franchise_name: string | null
    outlet_name: string | null
    fid: string | null
    oid: string | null
    status: string
    hidden: number
    category: string | null
    subcategory_1: string | null
    subcategory_2: string | null
    clickup_link: string | null
    clickup_task_id: string | null
    clickup_task_status: string | null
    resolved_at: string | null
    created_at: string
    last_message_at: string | null
    ms_agent_name: string | null
  }>).map((row) => ({
    id: row.id,
    customerName: row.customer_name,
    customerPhone: row.customer_phone,
    franchiseName: row.franchise_name,
    outletName: row.outlet_name,
    fid: row.fid,
    oid: row.oid,
    status: row.status,
    hidden: Boolean(row.hidden),
    category: row.category,
    subcategory1: row.subcategory_1,
    subcategory2: row.subcategory_2,
    clickupLink: row.clickup_link,
    clickupTaskId: row.clickup_task_id,
    clickupTaskStatus: row.clickup_task_status,
    resolvedAt: row.resolved_at,
    createdAt: row.created_at,
    lastMessageAt: row.last_message_at,
    msAgentName: row.ms_agent_name,
  }))

  return NextResponse.json({
    tickets,
    total,
    page,
    perPage,
  })
}
