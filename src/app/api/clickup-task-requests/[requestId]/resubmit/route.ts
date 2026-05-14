import { NextRequest, NextResponse } from "next/server"
import type { ResultSetHeader } from "mysql2/promise"

import getPool from "@/lib/db"
import {
  clickupRequestSelectSql,
  lookupTicketContext,
  mapClickupTaskRequest,
  parseRequestId,
  parseStringArray,
  resolveAuthUser,
  validateCreatePayload,
} from "../../helpers"

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ requestId: string }> }
) {
  const pool = getPool()
  const auth = await resolveAuthUser(request)
  if ("response" in auth) {
    return auth.response
  }

  const { requestId } = await params
  const parsedId = parseRequestId(requestId)
  if (!parsedId) {
    return NextResponse.json({ error: "Invalid request id." }, { status: 400 })
  }

  const [existingRows] = await pool.query(
    `
    ${clickupRequestSelectSql}
    WHERE requests.id = ?
    LIMIT 1
  `,
    [parsedId]
  )

  const existing = (existingRows as Parameters<typeof mapClickupTaskRequest>[0][])[0]
  if (!existing) {
    return NextResponse.json({ error: "Request not found." }, { status: 404 })
  }

  if (existing.status !== "Rejected") {
    return NextResponse.json(
      { error: "Only rejected requests can be resubmitted." },
      { status: 409 }
    )
  }

  if (String(existing.created_by_user_id ?? "") !== auth.user.id) {
    return NextResponse.json(
      { error: "Only the original requester can resubmit this request." },
      { status: 403 }
    )
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

  const [updateResult] = await pool.query<ResultSetHeader>(
    `
    UPDATE clickup_task_requests
    SET
      ticket_id = ?,
      fid = ?,
      oid = ?,
      franchise_name = ?,
      product = ?,
      department_request = ?,
      outlet_name_resolved = ?,
      ms_pic = ?,
      priority_level = ?,
      severity_level = ?,
      incident_title = ?,
      task_description = ?,
      attachment_url = ?,
      attachment_url_2 = ?,
      attachment_url_3 = ?,
      status = 'Pending Approval',
      decision_reason = NULL,
      decision_by_user_id = NULL,
      decision_by_email = NULL,
      decision_at = NULL,
      clickup_task_id = NULL,
      clickup_link = NULL
    WHERE id = ?
      AND status = 'Rejected'
      AND created_by_user_id = ?
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
      parsedId,
      auth.user.id,
    ]
  )

  if (updateResult.affectedRows === 0) {
    return NextResponse.json(
      { error: "Unable to resubmit request." },
      { status: 409 }
    )
  }

  const [rows] = await pool.query(
    `
    ${clickupRequestSelectSql}
    WHERE requests.id = ?
    LIMIT 1
  `,
    [parsedId]
  )

  const updated = (rows as Parameters<typeof mapClickupTaskRequest>[0][])[0]
  return NextResponse.json({ request: mapClickupTaskRequest(updated) })
}
