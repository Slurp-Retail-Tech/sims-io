import { NextRequest, NextResponse } from "next/server"
import type { ResultSetHeader } from "mysql2/promise"

import getPool from "@/lib/db"
import {
  clickupRequestSelectSql,
  getSortClause,
  lookupTicketContext,
  mapClickupTaskRequest,
  parseStringArray,
  resolveAuthUser,
  validateCreatePayload,
} from "./helpers"

const PER_PAGE_OPTIONS = new Set([10, 25, 50, 100])

export async function GET(request: NextRequest) {
  const pool = getPool()
  const auth = await resolveAuthUser(request)
  if ("response" in auth) {
    return auth.response
  }

  const { searchParams } = new URL(request.url)
  const section = searchParams.get("section") === "completed" ? "completed" : "pending"
  const sortBy = searchParams.get("sort_by")
  const direction = searchParams.get("direction")
  const orderBy = getSortClause(section, sortBy, direction)

  if (section === "pending") {
    const [rows] = await pool.query(
      `
      ${clickupRequestSelectSql}
      WHERE requests.status = 'Pending Approval'
      ORDER BY ${orderBy}
    `
    )

    return NextResponse.json({
      section,
      requests: (rows as Parameters<typeof mapClickupTaskRequest>[0][]).map(
        mapClickupTaskRequest
      ),
    })
  }

  const requestedScope = searchParams.get("scope") === "mine" ? "mine" : "all"
  const scope = requestedScope
  const pageParam = Number.parseInt(searchParams.get("page") ?? "1", 10)
  const perPageParam = Number.parseInt(searchParams.get("per_page") ?? "10", 10)
  const page = Number.isFinite(pageParam) && pageParam > 0 ? pageParam : 1
  const perPage = PER_PAGE_OPTIONS.has(perPageParam) ? perPageParam : 10
  const offset = (page - 1) * perPage

  const whereClauses = ["requests.status IN ('Approved', 'Rejected')"]
  const values: Array<string | number> = []

  if (scope === "mine") {
    whereClauses.push("requests.created_by_user_id = ?")
    values.push(auth.user.id)
  }

  const whereSql = `WHERE ${whereClauses.join(" AND ")}`

  const [countRows] = await pool.query(
    `
    SELECT COUNT(*) AS total
    FROM clickup_task_requests AS requests
    ${whereSql}
  `,
    values
  )

  const totalValue = (countRows as Array<{ total: number | string }>)[0]?.total ?? 0
  const total = typeof totalValue === "string" ? Number.parseInt(totalValue, 10) : totalValue

  const [rows] = await pool.query(
    `
    ${clickupRequestSelectSql}
    ${whereSql}
    ORDER BY ${orderBy}
    LIMIT ? OFFSET ?
  `,
    [...values, perPage, offset]
  )

  return NextResponse.json({
    section,
    scope,
    requests: (rows as Parameters<typeof mapClickupTaskRequest>[0][]).map(
      mapClickupTaskRequest
    ),
    page,
    perPage,
    total,
  })
}

export async function POST(request: NextRequest) {
  const pool = getPool()
  const auth = await resolveAuthUser(request)
  if ("response" in auth) {
    return auth.response
  }

  const body = (await request.json()) as {
    ticketId?: unknown
    fid?: unknown
    oid?: unknown
    franchiseName?: unknown
    product?: unknown
    departmentRequest?: unknown
    outletName?: unknown
    msPic?: unknown
    priorityLevel?: unknown
    severityLevel?: unknown
    incidentTitle?: unknown
    taskDescription?: unknown
    attachments?: unknown
  }

  const validated = validateCreatePayload(body)
  if ("error" in validated) {
    return NextResponse.json({ error: validated.error }, { status: 400 })
  }

  const attachments = parseStringArray(body.attachments, 3)

  let ticketId: number | null = null
  if (typeof body.ticketId === "string" && body.ticketId.trim()) {
    const parsed = Number.parseInt(body.ticketId.trim(), 10)
    if (!Number.isFinite(parsed) || parsed <= 0) {
      return NextResponse.json({ error: "Invalid ticket id." }, { status: 400 })
    }
    ticketId = parsed
  }

  let fid = typeof body.fid === "string" && body.fid.trim() ? body.fid.trim() : null
  let oid = typeof body.oid === "string" && body.oid.trim() ? body.oid.trim() : null
  let franchiseName =
    typeof body.franchiseName === "string" && body.franchiseName.trim()
      ? body.franchiseName.trim()
      : null
  let outletName = validated.outletName

  if (ticketId) {
    const ticket = await lookupTicketContext(pool, ticketId)
    if (!ticket) {
      return NextResponse.json({ error: "Ticket not found." }, { status: 404 })
    }
    fid = ticket.fid ?? fid
    oid = ticket.oid ?? oid
    franchiseName = ticket.franchise_name_resolved ?? franchiseName
    outletName = ticket.outlet_name_resolved ?? outletName
  }

  const [result] = await pool.query<ResultSetHeader>(
    `
    INSERT INTO clickup_task_requests (
      ticket_id,
      fid,
      oid,
      franchise_name,
      product,
      department_request,
      outlet_name_resolved,
      ms_pic,
      priority_level,
      severity_level,
      incident_title,
      task_description,
      attachment_url,
      attachment_url_2,
      attachment_url_3,
      status,
      created_by_user_id,
      created_by_email
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Pending Approval', ?, ?)
  `,
    [
      ticketId,
      fid,
      oid,
      franchiseName,
      validated.product,
      validated.departmentRequest,
      outletName,
      validated.msPic,
      validated.priorityLevel,
      validated.severityLevel,
      validated.incidentTitle,
      validated.taskDescription,
      attachments[0] ?? null,
      attachments[1] ?? null,
      attachments[2] ?? null,
      auth.user.id,
      auth.user.email,
    ]
  )

  const [rows] = await pool.query(
    `
    ${clickupRequestSelectSql}
    WHERE requests.id = ?
    LIMIT 1
  `,
    [result.insertId]
  )

  const created = (rows as Parameters<typeof mapClickupTaskRequest>[0][])[0]
  return NextResponse.json({ request: mapClickupTaskRequest(created) }, { status: 201 })
}
