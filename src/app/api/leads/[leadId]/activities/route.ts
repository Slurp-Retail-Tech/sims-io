import { NextRequest, NextResponse } from "next/server"
import type { ResultSetHeader } from "mysql2/promise"

import getPool from "@/lib/db"
import { canEditLead, canViewLead } from "@/lib/leads"
import {
  activitySelectSql,
  isActivityType,
  mapActivity,
  validateActivityInput,
  type ActivityRow,
} from "@/lib/lead-activities"
import {
  cleanString,
  loadLeadAssignment,
  parseLeadId,
  resolveActivityDealId,
  resolveLeadsUser,
} from "../../helpers"

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

  const lead = await loadLeadAssignment(parsedLeadId)
  if (!lead || !canViewLead(user, lead)) {
    return NextResponse.json({ error: "Lead not found." }, { status: 404 })
  }

  const { searchParams } = new URL(request.url)
  const typeParam = cleanString(searchParams.get("type"))

  const whereClauses = ["lead_activities.lead_id = ?"]
  const values: Array<string | number> = [parsedLeadId]

  if (typeParam && typeParam !== "All") {
    if (!isActivityType(typeParam)) {
      return NextResponse.json({ error: "Invalid activity type." }, { status: 400 })
    }
    whereClauses.push("lead_activities.activity_type = ?")
    values.push(typeParam)
  }

  const pool = getPool()
  const [rows] = await pool.query(
    `
      ${activitySelectSql}
      WHERE ${whereClauses.join(" AND ")}
      ORDER BY
        COALESCE(lead_activities.activity_date, lead_activities.created_at) DESC,
        lead_activities.created_at DESC
    `,
    values
  )
  return NextResponse.json({ activities: (rows as ActivityRow[]).map(mapActivity) })
}

type CreateActivityBody = {
  activityType?: unknown
  activityDate?: unknown
  remarks?: unknown
  callOutcome?: unknown
  callDirection?: unknown
  meetingOutcome?: unknown
  locationType?: unknown
  location?: unknown
  dealId?: unknown
}

export async function POST(
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

  const lead = await loadLeadAssignment(parsedLeadId)
  if (!lead || !canViewLead(user, lead)) {
    return NextResponse.json({ error: "Lead not found." }, { status: 404 })
  }
  if (!canEditLead(user, lead)) {
    return NextResponse.json({ error: "Forbidden." }, { status: 403 })
  }

  let body: CreateActivityBody
  try {
    body = (await request.json()) as CreateActivityBody
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 })
  }

  const activityTypeRaw = cleanString(body.activityType)
  if (!activityTypeRaw || !isActivityType(activityTypeRaw)) {
    return NextResponse.json({ error: "Invalid activity type." }, { status: 400 })
  }

  const validated = validateActivityInput({
    activityType: activityTypeRaw,
    activityDate: cleanString(body.activityDate),
    remarks: cleanString(body.remarks),
    callOutcome: cleanString(body.callOutcome),
    callDirection: cleanString(body.callDirection),
    meetingOutcome: cleanString(body.meetingOutcome),
    locationType: cleanString(body.locationType),
    location: cleanString(body.location),
    dealId: cleanString(body.dealId),
  })
  if (!validated.ok) {
    return NextResponse.json({ error: validated.error }, { status: 400 })
  }
  const v = validated.values

  const dealLink = await resolveActivityDealId(v.dealId, parsedLeadId)
  if ("error" in dealLink) {
    return NextResponse.json({ error: dealLink.error }, { status: 400 })
  }

  const pool = getPool()
  const [insertResult] = await pool.query<ResultSetHeader>(
    `
      INSERT INTO lead_activities (
        lead_id, deal_id, activity_type, activity_date, remarks,
        call_outcome, call_direction, meeting_outcome, location_type, location,
        created_by_user_id
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    [
      parsedLeadId,
      dealLink.dealId,
      v.activityType,
      v.activityDate ? v.activityDate.slice(0, 23).replace("T", " ") : null,
      v.remarks,
      v.callOutcome,
      v.callDirection,
      v.meetingOutcome,
      v.locationType,
      v.location,
      user.id,
    ]
  )

  // Logging any activity means the lead has now been worked. Flip the status
  // on its first activity; the guard keeps this a no-op once already Worked.
  await pool.query<ResultSetHeader>(
    `UPDATE leads SET status = 'Worked', updated_at = CURRENT_TIMESTAMP(3) WHERE id = ? AND status = 'Unworked'`,
    [parsedLeadId]
  )

  const [rows] = await pool.query(
    `${activitySelectSql} WHERE lead_activities.id = ? LIMIT 1`,
    [insertResult.insertId]
  )
  return NextResponse.json(
    { activity: mapActivity((rows as ActivityRow[])[0]) },
    { status: 201 }
  )
}
