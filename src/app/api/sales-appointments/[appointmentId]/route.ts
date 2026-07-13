import { NextRequest, NextResponse } from "next/server"

import getPool from "@/lib/db"
import { parseDate } from "@/lib/dates"
import { syncSalesAppointmentToGoogleCalendar } from "@/lib/google-calendar"

import {
  appointmentSelectSql,
  canEditAppointment,
  cleanString,
  isAppointmentType,
  mapAppointment,
  parseAppointmentId,
  parseOptionalCoordinate,
  parseOptionalId,
  parseParticipantEmails,
  resolveAuthUser,
  toSqlDateTime,
} from "../helpers"

async function loadAppointment(
  pool: ReturnType<typeof getPool>,
  appointmentId: number
) {
  const [rows] = await pool.query(
    `
    ${appointmentSelectSql}
    WHERE appointments.id = ?
    LIMIT 1
  `,
    [appointmentId]
  )

  return (rows as Parameters<typeof mapAppointment>[0][])[0] ?? null
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ appointmentId: string }> }
) {
  const pool = getPool()
  const auth = await resolveAuthUser(request)
  if ("response" in auth) {
    return auth.response
  }

  const { appointmentId: rawAppointmentId } = await context.params
  const appointmentId = parseAppointmentId(rawAppointmentId)
  if (!appointmentId) {
    return NextResponse.json({ error: "Invalid appointment id." }, { status: 400 })
  }

  const appointment = await loadAppointment(pool, appointmentId)
  if (!appointment) {
    return NextResponse.json({ error: "Appointment not found." }, { status: 404 })
  }

  return NextResponse.json({
    appointment: mapAppointment(appointment, auth.user),
  })
}

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ appointmentId: string }> }
) {
  const pool = getPool()
  const auth = await resolveAuthUser(request)
  if ("response" in auth) {
    return auth.response
  }

  const { appointmentId: rawAppointmentId } = await context.params
  const appointmentId = parseAppointmentId(rawAppointmentId)
  if (!appointmentId) {
    return NextResponse.json({ error: "Invalid appointment id." }, { status: 400 })
  }

  const loaded = await loadAppointment(pool, appointmentId)
  if (!loaded) {
    return NextResponse.json({ error: "Appointment not found." }, { status: 404 })
  }

  if (!canEditAppointment(auth.user, loaded)) {
    return NextResponse.json({ error: "Forbidden." }, { status: 403 })
  }

  const body = (await request.json()) as {
    leadId?: unknown
    customerName?: unknown
    businessName?: unknown
    businessType?: unknown
    businessLocation?: unknown
    meetingLocation?: unknown
    googlePlaceId?: unknown
    googleMapsUri?: unknown
    locationLat?: unknown
    locationLng?: unknown
    participantEmails?: unknown
    appointmentType?: unknown
    scheduledAt?: unknown
  }

  const updates: string[] = []
  const params: Array<string | number | null> = []
  const nextAppointmentType = Object.hasOwn(body, "appointmentType")
    ? cleanString(body.appointmentType)
    : loaded.appointment_type
  const nextMeetingLocation = Object.hasOwn(body, "meetingLocation")
    ? cleanString(body.meetingLocation)
    : loaded.meeting_location

  if (Object.hasOwn(body, "leadId")) {
    if (body.leadId === null || body.leadId === "") {
      updates.push("lead_id = NULL")
    } else if (String(loaded.lead_id ?? "") === String(body.leadId)) {
      updates.push("lead_id = ?")
      params.push(loaded.lead_id ? Number(loaded.lead_id) : null)
    } else {
      const leadId = parseOptionalId(body.leadId)
      if (leadId === null) {
        return NextResponse.json({ error: "Invalid lead." }, { status: 400 })
      }

      const [leadRows] = await pool.query(
        `
        SELECT id
        FROM leads
        WHERE id = ? AND archived = FALSE
        LIMIT 1
      `,
        [leadId]
      )
      if ((leadRows as Array<{ id: number | string }>).length === 0) {
        return NextResponse.json(
          { error: "Selected lead is not available." },
          { status: 400 }
        )
      }

      updates.push("lead_id = ?")
      params.push(leadId)
    }
  }

  if (Object.hasOwn(body, "customerName")) {
    const customerName = cleanString(body.customerName)
    if (!customerName) {
      return NextResponse.json(
        { error: "Customer name is required." },
        { status: 400 }
      )
    }
    updates.push("customer_name = ?")
    params.push(customerName)
  }

  if (Object.hasOwn(body, "businessName")) {
    const businessName = cleanString(body.businessName)
    if (!businessName) {
      return NextResponse.json(
        { error: "Business name is required." },
        { status: 400 }
      )
    }
    updates.push("business_name = ?")
    params.push(businessName)
  }

  if (Object.hasOwn(body, "businessType")) {
    const businessType = cleanString(body.businessType)
    if (!businessType) {
      return NextResponse.json(
        { error: "Business type is required." },
        { status: 400 }
      )
    }
    updates.push("business_type = ?")
    params.push(businessType)
  }

  if (Object.hasOwn(body, "businessLocation")) {
    const businessLocation = cleanString(body.businessLocation)
    if (!businessLocation) {
      return NextResponse.json(
        { error: "Business location is required." },
        { status: 400 }
      )
    }
    updates.push("business_location = ?")
    params.push(businessLocation)
  }

  if (Object.hasOwn(body, "meetingLocation") && nextAppointmentType !== "Online") {
    updates.push("meeting_location = ?")
    params.push(nextMeetingLocation)
  }

  // Place fields travel as a group keyed on googlePlaceId presence in the
  // body (the UI always sends all four together). Without a place id the
  // group is nulled so a free-text overwrite never leaves stale coordinates.
  if (Object.hasOwn(body, "googlePlaceId") && nextAppointmentType !== "Online") {
    const googlePlaceId = cleanString(body.googlePlaceId)
    const googleMapsUri = googlePlaceId ? cleanString(body.googleMapsUri) : null
    const locationLat = googlePlaceId
      ? parseOptionalCoordinate(body.locationLat, 90)
      : null
    const locationLng = googlePlaceId
      ? parseOptionalCoordinate(body.locationLng, 180)
      : null
    updates.push(
      "google_place_id = ?",
      "google_maps_uri = ?",
      "location_lat = ?",
      "location_lng = ?"
    )
    params.push(googlePlaceId, googleMapsUri, locationLat, locationLng)
  }

  if (Object.hasOwn(body, "participantEmails")) {
    if (nextAppointmentType === "Online") {
      updates.push("participant_emails = ?")
      params.push(parseParticipantEmails(body.participantEmails).join(",") || null)
    }
  }

  if (Object.hasOwn(body, "appointmentType")) {
    if (!nextAppointmentType || !isAppointmentType(nextAppointmentType)) {
      return NextResponse.json(
        { error: "Invalid appointment type." },
        { status: 400 }
      )
    }
    updates.push("appointment_type = ?")
    params.push(nextAppointmentType)
  }

  if (nextAppointmentType === "Physical" && !nextMeetingLocation) {
    return NextResponse.json(
      { error: "Meeting location is required for physical appointments." },
      { status: 400 }
    )
  }

  if (
    nextAppointmentType === "Online" &&
    (Object.hasOwn(body, "appointmentType") || Object.hasOwn(body, "meetingLocation"))
  ) {
    updates.push(
      "meeting_location = NULL",
      "google_place_id = NULL",
      "google_maps_uri = NULL",
      "location_lat = NULL",
      "location_lng = NULL"
    )
  }

  // Participant invites only apply to Online meetings.
  if (
    nextAppointmentType === "Physical" &&
    Object.hasOwn(body, "appointmentType")
  ) {
    updates.push("participant_emails = NULL")
  }

  if (Object.hasOwn(body, "scheduledAt")) {
    const scheduledAtRaw = cleanString(body.scheduledAt)
    const scheduledAt = scheduledAtRaw ? parseDate(scheduledAtRaw) : null
    if (!scheduledAt) {
      return NextResponse.json({ error: "Invalid schedule date." }, { status: 400 })
    }
    updates.push("scheduled_at = ?")
    params.push(toSqlDateTime(scheduledAt))
  }

  if (updates.length === 0) {
    return NextResponse.json({ error: "No changes requested." }, { status: 400 })
  }

  await pool.query(
    `
    UPDATE sales_appointments
    SET ${updates.join(", ")}, updated_at = CURRENT_TIMESTAMP(3)
    WHERE id = ?
  `,
    [...params, appointmentId]
  )

  const refreshed = await loadAppointment(pool, appointmentId)
  if (!refreshed) {
    return NextResponse.json({ error: "Appointment not found." }, { status: 404 })
  }

  const mappedAppointment = mapAppointment(refreshed, auth.user)

  await syncSalesAppointmentToGoogleCalendar(pool, mappedAppointment)

  return NextResponse.json({ appointment: mappedAppointment })
}
