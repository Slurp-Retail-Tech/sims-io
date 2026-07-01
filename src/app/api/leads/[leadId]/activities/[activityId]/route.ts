import { NextRequest, NextResponse } from "next/server"
import type { ResultSetHeader } from "mysql2/promise"

import getPool from "@/lib/db"
import { canEditLead } from "@/lib/leads"
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
} from "../../../helpers"

function parseActivityId(value: string): number | null {
  const parsed = Number.parseInt(value, 10)
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null
  }
  return parsed
}

type LoadedActivity =
  | { response: NextResponse }
  | { leadId: number; activityId: number; existing: ActivityRow }

async function loadEditableActivity(
  request: NextRequest,
  params: Promise<{ leadId: string; activityId: string }>
): Promise<LoadedActivity> {
  const auth = await resolveLeadsUser(request)
  if ("response" in auth) {
    return { response: auth.response }
  }
  const { user } = auth

  const { leadId, activityId } = await params
  const parsedLeadId = parseLeadId(leadId)
  const parsedActivityId = parseActivityId(activityId)
  if (parsedLeadId === null || parsedActivityId === null) {
    return { response: NextResponse.json({ error: "Invalid id." }, { status: 400 }) }
  }

  const lead = await loadLeadAssignment(parsedLeadId)
  if (!lead || !canEditLead(user, lead)) {
    return { response: NextResponse.json({ error: "Lead not found." }, { status: 404 }) }
  }

  const pool = getPool()
  const [existingRows] = await pool.query(
    `${activitySelectSql} WHERE lead_activities.id = ? AND lead_activities.lead_id = ? LIMIT 1`,
    [parsedActivityId, parsedLeadId]
  )
  const existing = (existingRows as ActivityRow[])[0]
  if (!existing) {
    return { response: NextResponse.json({ error: "Activity not found." }, { status: 404 }) }
  }

  return { leadId: parsedLeadId, activityId: parsedActivityId, existing }
}

type PatchActivityBody = {
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

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ leadId: string; activityId: string }> }
) {
  const loaded = await loadEditableActivity(request, context.params)
  if ("response" in loaded) {
    return loaded.response
  }
  const { leadId, activityId, existing } = loaded

  let body: PatchActivityBody
  try {
    body = (await request.json()) as PatchActivityBody
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 })
  }

  const activityTypeRaw = cleanString(body.activityType) ?? existing.activity_type
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

  const dealLink = await resolveActivityDealId(v.dealId, leadId)
  if ("error" in dealLink) {
    return NextResponse.json({ error: dealLink.error }, { status: 400 })
  }

  const pool = getPool()
  await pool.query<ResultSetHeader>(
    `
      UPDATE lead_activities
      SET deal_id = ?, activity_type = ?, activity_date = ?, remarks = ?,
          call_outcome = ?, call_direction = ?, meeting_outcome = ?,
          location_type = ?, location = ?, updated_at = CURRENT_TIMESTAMP(3)
      WHERE id = ? AND lead_id = ?
    `,
    [
      dealLink.dealId,
      v.activityType,
      v.activityDate ? v.activityDate.slice(0, 23).replace("T", " ") : null,
      v.remarks,
      v.callOutcome,
      v.callDirection,
      v.meetingOutcome,
      v.locationType,
      v.location,
      activityId,
      leadId,
    ]
  )

  const [rows] = await pool.query(
    `${activitySelectSql} WHERE lead_activities.id = ? LIMIT 1`,
    [activityId]
  )
  return NextResponse.json({ activity: mapActivity((rows as ActivityRow[])[0]) })
}

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ leadId: string; activityId: string }> }
) {
  const loaded = await loadEditableActivity(request, context.params)
  if ("response" in loaded) {
    return loaded.response
  }
  const { leadId, activityId } = loaded

  const pool = getPool()
  await pool.query<ResultSetHeader>(
    `DELETE FROM lead_activities WHERE id = ? AND lead_id = ?`,
    [activityId, leadId]
  )
  return NextResponse.json({ ok: true })
}
