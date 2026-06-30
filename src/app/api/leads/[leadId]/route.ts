import { NextRequest, NextResponse } from "next/server"
import type { ResultSetHeader } from "mysql2/promise"

import getPool from "@/lib/db"
import {
  canEditLead,
  canViewLead,
  isLeadManager,
  leadSelectSql,
  mapLead,
  type LeadRow,
} from "@/lib/leads"
import {
  cleanString,
  parseLeadId,
  parseOptionalUserId,
  resolveLeadsUser,
  TELEPHONE_PATTERN,
} from "../helpers"

async function loadLead(leadId: number): Promise<LeadRow | null> {
  const pool = getPool()
  const [rows] = await pool.query(
    `${leadSelectSql} WHERE leads.id = ? LIMIT 1`,
    [leadId]
  )
  return (rows as LeadRow[])[0] ?? null
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ leadId: string }> }
) {
  const auth = await resolveLeadsUser(request)
  if ("response" in auth) {
    return auth.response
  }
  const { user } = auth

  const { leadId } = await context.params
  const parsedLeadId = parseLeadId(leadId)
  if (parsedLeadId === null) {
    return NextResponse.json({ error: "Invalid lead id." }, { status: 400 })
  }

  const lead = await loadLead(parsedLeadId)
  // 404 (not 403) for a non-manager viewing a lead that isn't theirs, so we
  // don't leak the existence of leads assigned to other users.
  if (!lead || !canViewLead(user, lead)) {
    return NextResponse.json({ error: "Lead not found." }, { status: 404 })
  }

  return NextResponse.json({ lead: mapLead(lead) })
}

type ArchiveBody = { archived: boolean }
type EditBody = {
  name?: unknown
  telephone?: unknown
  email?: unknown
  businessName?: unknown
  businessType?: unknown
  businessLocation?: unknown
  assignedUserId?: unknown
}

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ leadId: string }> }
) {
  const auth = await resolveLeadsUser(request)
  if ("response" in auth) {
    return auth.response
  }
  const { user } = auth

  const { leadId } = await context.params
  const parsedLeadId = parseLeadId(leadId)
  if (parsedLeadId === null) {
    return NextResponse.json({ error: "Invalid lead id." }, { status: 400 })
  }

  let body: Record<string, unknown>
  try {
    body = (await request.json()) as Record<string, unknown>
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 })
  }

  const lead = await loadLead(parsedLeadId)
  if (!lead || !canViewLead(user, lead)) {
    return NextResponse.json({ error: "Lead not found." }, { status: 404 })
  }
  if (!canEditLead(user, lead)) {
    return NextResponse.json({ error: "Forbidden." }, { status: 403 })
  }

  const pool = getPool()

  // Branch 1: archive / unarchive (existing behaviour).
  if (typeof (body as ArchiveBody).archived === "boolean") {
    await pool.query<ResultSetHeader>(
      `UPDATE leads SET archived = ?, updated_at = CURRENT_TIMESTAMP(3) WHERE id = ?`,
      [(body as ArchiveBody).archived, parsedLeadId]
    )
    const updated = await loadLead(parsedLeadId)
    return NextResponse.json({ lead: updated ? mapLead(updated) : null })
  }

  // Branch 2: field edit. Source is intentionally NOT editable.
  const edit = body as EditBody
  const sets: string[] = []
  const values: Array<string | number | null> = []

  const assign = (column: string, value: string | number | null) => {
    sets.push(`${column} = ?`)
    values.push(value)
  }

  if (edit.name !== undefined) {
    const name = cleanString(edit.name)
    if (!name) {
      return NextResponse.json({ error: "Name is required." }, { status: 400 })
    }
    assign("name", name)
  }

  if (edit.telephone !== undefined) {
    const telephone = cleanString(edit.telephone)
    if (!telephone || !TELEPHONE_PATTERN.test(telephone)) {
      return NextResponse.json(
        { error: "Telephone must contain 8 to 15 digits." },
        { status: 400 }
      )
    }
    assign("telephone", telephone)
  }

  if (edit.businessType !== undefined) {
    const businessType = cleanString(edit.businessType)
    if (!businessType) {
      return NextResponse.json(
        { error: "Business type is required." },
        { status: 400 }
      )
    }
    assign("business_type", businessType)
  }

  if (edit.businessLocation !== undefined) {
    const businessLocation = cleanString(edit.businessLocation)
    if (!businessLocation) {
      return NextResponse.json(
        { error: "Business location is required." },
        { status: 400 }
      )
    }
    assign("business_location", businessLocation)
  }

  if (edit.email !== undefined) {
    assign("email", cleanString(edit.email))
  }

  if (edit.businessName !== undefined) {
    assign("business_name", cleanString(edit.businessName))
  }

  if (edit.assignedUserId !== undefined) {
    const requestedAssignee = parseOptionalUserId(edit.assignedUserId)
    // Only managers can (re)assign leads to other users.
    if (!isLeadManager(user)) {
      if (
        requestedAssignee !== null &&
        String(requestedAssignee) !== user.id
      ) {
        return NextResponse.json(
          { error: "You cannot reassign this lead." },
          { status: 403 }
        )
      }
    }
    if (requestedAssignee !== null) {
      const [assigneeRows] = await pool.query(
        `SELECT id FROM users WHERE id = ? LIMIT 1`,
        [requestedAssignee]
      )
      if ((assigneeRows as unknown[]).length === 0) {
        return NextResponse.json(
          { error: "Assigned user not found." },
          { status: 400 }
        )
      }
    }
    assign("assigned_user_id", requestedAssignee)
  }

  if (sets.length === 0) {
    return NextResponse.json(
      { error: "No editable fields provided." },
      { status: 400 }
    )
  }

  await pool.query<ResultSetHeader>(
    `UPDATE leads SET ${sets.join(", ")}, updated_at = CURRENT_TIMESTAMP(3) WHERE id = ?`,
    [...values, parsedLeadId]
  )

  const updated = await loadLead(parsedLeadId)
  return NextResponse.json({ lead: updated ? mapLead(updated) : null })
}
