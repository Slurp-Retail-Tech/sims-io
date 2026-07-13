import { NextRequest, NextResponse } from "next/server"
import type { ResultSetHeader } from "mysql2/promise"

import getPool from "@/lib/db"
import { parseDate } from "@/lib/dates"
import { canEditLead } from "@/lib/leads"
import {
  activitySelectSql,
  isActivityType,
  mapActivity,
  validateActivityInput,
  type ActivityRow,
} from "@/lib/lead-activities"
import {
  cancelSalesAppointment,
  updateSalesAppointmentFromActivity,
} from "@/lib/sales-appointments"
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
  | {
      leadId: number
      activityId: number
      existing: ActivityRow
      userId: string
    }

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

  return {
    leadId: parsedLeadId,
    activityId: parsedActivityId,
    existing,
    userId: user.id,
  }
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
  googlePlaceId?: unknown
  googleMapsUri?: unknown
  locationLat?: unknown
  locationLng?: unknown
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
  const { leadId, activityId, existing, userId } = loaded

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
    googlePlaceId: cleanString(body.googlePlaceId),
    googleMapsUri: cleanString(body.googleMapsUri),
    locationLat: cleanString(body.locationLat),
    locationLng: cleanString(body.locationLng),
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
          location_type = ?, location = ?,
          google_place_id = ?, google_maps_uri = ?, location_lat = ?, location_lng = ?,
          updated_at = CURRENT_TIMESTAMP(3)
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
      v.googlePlaceId,
      v.googleMapsUri,
      v.locationLat,
      v.locationLng,
      activityId,
      leadId,
    ]
  )

  // Cascade to the linked sales appointment (fail-open — the activity edit is
  // already saved). Only still-Pending appointments are ever touched; the lib
  // functions also re-check status inside the UPDATE itself.
  const linkedAppointmentId = existing.sales_appointment_id
    ? Number(existing.sales_appointment_id)
    : null
  let appointmentUpdated = false
  let appointmentCanceled = false
  let appointmentError: string | null = null

  if (linkedAppointmentId && existing.sales_appointment_status === "Pending") {
    const shouldCancel =
      (existing.activity_type === "Meeting" && v.activityType !== "Meeting") ||
      (v.meetingOutcome === "Canceled" && existing.meeting_outcome !== "Canceled")

    // Compare parsed timestamps, not raw strings: existing.activity_date is a
    // SQL datetime string (dateStrings pool) while v.activityDate is ISO.
    const existingDateMs = existing.activity_date
      ? (parseDate(existing.activity_date)?.valueOf() ?? null)
      : null
    const nextDate = v.activityDate ? parseDate(v.activityDate) : null
    const meetingFieldsChanged =
      v.activityType === "Meeting" &&
      ((nextDate?.valueOf() ?? null) !== existingDateMs ||
        v.locationType !== existing.location_type ||
        v.location !== existing.location ||
        v.googlePlaceId !== existing.google_place_id)

    try {
      if (shouldCancel) {
        const result = await cancelSalesAppointment(pool, linkedAppointmentId, {
          canceledByUserId: userId,
          reason: "Meeting canceled from lead activity",
        })
        appointmentCanceled = result.status === "canceled"
      } else if (meetingFieldsChanged) {
        if (!nextDate) {
          throw new Error("Activity has no valid meeting date")
        }
        const result = await updateSalesAppointmentFromActivity(
          pool,
          linkedAppointmentId,
          {
            scheduledAt: nextDate,
            appointmentType: v.locationType === "Onsite" ? "Physical" : "Online",
            meetingLocation: v.location,
            googlePlaceId: v.googlePlaceId,
            googleMapsUri: v.googleMapsUri,
            locationLat: v.locationLat,
            locationLng: v.locationLng,
          }
        )
        appointmentUpdated = result.status === "updated"
      }
    } catch (error) {
      console.error(
        "Unable to cascade lead activity edit to sales appointment",
        error
      )
      appointmentError =
        "Activity saved, but the linked sales appointment could not be updated."
    }
  }

  const [rows] = await pool.query(
    `${activitySelectSql} WHERE lead_activities.id = ? LIMIT 1`,
    [activityId]
  )
  return NextResponse.json({
    activity: mapActivity((rows as ActivityRow[])[0]),
    ...(linkedAppointmentId
      ? { appointmentUpdated, appointmentCanceled, appointmentError }
      : {}),
  })
}

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ leadId: string; activityId: string }> }
) {
  const loaded = await loadEditableActivity(request, context.params)
  if ("response" in loaded) {
    return loaded.response
  }
  const { leadId, activityId, existing, userId } = loaded

  const pool = getPool()

  // Cancel a linked, still-Pending appointment before the row (and with it
  // the link) disappears. Fail-open: a cancel failure never blocks the delete.
  let appointmentCanceled = false
  if (
    existing.sales_appointment_id &&
    existing.sales_appointment_status === "Pending"
  ) {
    try {
      const result = await cancelSalesAppointment(
        pool,
        Number(existing.sales_appointment_id),
        { canceledByUserId: userId, reason: "Meeting activity deleted" }
      )
      appointmentCanceled = result.status === "canceled"
    } catch (error) {
      console.error(
        "Unable to cancel linked sales appointment on activity delete",
        error
      )
    }
  }

  await pool.query<ResultSetHeader>(
    `DELETE FROM lead_activities WHERE id = ? AND lead_id = ?`,
    [activityId, leadId]
  )
  return NextResponse.json({ ok: true, appointmentCanceled })
}
