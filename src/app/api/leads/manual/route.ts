import { NextRequest, NextResponse } from "next/server"
import type { ResultSetHeader } from "mysql2/promise"

import getPool from "@/lib/db"
import { isLeadManager, leadSelectSql, mapLead, type LeadRow } from "@/lib/leads"
import { sendLeadAssignmentEmail } from "@/lib/lead-assignment-notification"
import {
  cleanString,
  parseOptionalUserId,
  resolveLeadsUser,
  TELEPHONE_PATTERN,
} from "../helpers"

type ManualLeadBody = {
  name?: unknown
  telephone?: unknown
  email?: unknown
  businessName?: unknown
  businessType?: unknown
  businessLocation?: unknown
  assignedUserId?: unknown
}

export async function POST(request: NextRequest) {
  const auth = await resolveLeadsUser(request)
  if ("response" in auth) {
    return auth.response
  }
  const { user } = auth

  let body: ManualLeadBody
  try {
    body = (await request.json()) as ManualLeadBody
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 })
  }

  const name = cleanString(body.name)
  const telephone = cleanString(body.telephone)
  const businessType = cleanString(body.businessType)
  const businessLocation = cleanString(body.businessLocation)
  const email = cleanString(body.email)
  const businessName = cleanString(body.businessName)

  if (!name || !telephone || !businessType || !businessLocation) {
    return NextResponse.json({ error: "Missing required fields." }, { status: 400 })
  }

  if (!TELEPHONE_PATTERN.test(telephone)) {
    return NextResponse.json(
      { error: "Telephone must contain 8 to 15 digits." },
      { status: 400 }
    )
  }

  // Assignment rules: managers may assign to anyone or leave unassigned; a
  // non-manager may only assign the lead to themselves.
  const requestedAssignee = parseOptionalUserId(body.assignedUserId)
  let assignedUserId: number | null = requestedAssignee
  if (!isLeadManager(user)) {
    if (requestedAssignee !== null && String(requestedAssignee) !== user.id) {
      return NextResponse.json(
        { error: "You can only assign leads to yourself." },
        { status: 403 }
      )
    }
    assignedUserId = Number.parseInt(user.id, 10)
  }

  const pool = getPool()

  // Notify the assignee unless the creator assigned the lead to themselves.
  let assignee: { name: string; email: string } | null = null
  if (assignedUserId !== null) {
    const [assigneeRows] = await pool.query(
      `SELECT id, name, email FROM users WHERE id = ? LIMIT 1`,
      [assignedUserId]
    )
    const row = (assigneeRows as Array<{ name: string; email: string }>)[0]
    if (!row) {
      return NextResponse.json(
        { error: "Assigned user not found." },
        { status: 400 }
      )
    }
    if (String(assignedUserId) !== user.id) {
      assignee = { name: row.name, email: row.email }
    }
  }

  const [insertResult] = await pool.query<ResultSetHeader>(
    `
      INSERT INTO leads (
        name,
        telephone,
        email,
        business_name,
        business_type,
        business_location,
        source,
        assigned_user_id
      )
      VALUES (?, ?, ?, ?, ?, ?, 'manual', ?)
    `,
    [
      name,
      telephone,
      email,
      businessName,
      businessType,
      businessLocation,
      assignedUserId,
    ]
  )

  const leadId = String(insertResult.insertId)
  const [rows] = await pool.query(
    `${leadSelectSql} WHERE leads.id = ? LIMIT 1`,
    [leadId]
  )
  const lead = (rows as LeadRow[])[0]

  // Best-effort assignment notification; a mail failure must not fail creation.
  if (assignee) {
    try {
      await sendLeadAssignmentEmail({
        recipient: assignee,
        lead: {
          id: String(lead.id),
          name: lead.name,
          telephone: lead.telephone,
          businessType: lead.business_type,
          businessLocation: lead.business_location,
        },
        origin: request.headers.get("origin") ?? new URL(request.url).origin,
      })
    } catch (error) {
      console.error("Failed to send lead assignment email", error)
    }
  }

  return NextResponse.json({ lead: mapLead(lead) }, { status: 201 })
}
