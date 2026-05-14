import { NextRequest, NextResponse } from "next/server"

import getPool from "@/lib/db"
import { syncOnboardingAppointmentToGoogleCalendar } from "@/lib/google-calendar"

import {
  appointmentSelectSql,
  fetchAppointmentAttachments,
  isMerchantSuccessReviewer,
  mapAppointment,
  parseAppointmentId,
  resolveAuthUser,
} from "../../helpers"

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ appointmentId: string }> }
) {
  const pool = getPool()
  const auth = await resolveAuthUser(request)
  if ("response" in auth) {
    return auth.response
  }

  if (!isMerchantSuccessReviewer(auth.user)) {
    return NextResponse.json({ error: "Forbidden." }, { status: 403 })
  }

  const { appointmentId: rawAppointmentId } = await context.params
  const appointmentId = parseAppointmentId(rawAppointmentId)
  if (!appointmentId) {
    return NextResponse.json({ error: "Invalid appointment id." }, { status: 400 })
  }

  const body = (await request.json()) as {
    action?: unknown
    reason?: unknown
  }

  const action = typeof body.action === "string" ? body.action.trim() : ""
  const reason =
    typeof body.reason === "string" && body.reason.trim()
      ? body.reason.trim()
      : null

  if (action !== "approve" && action !== "complete") {
    return NextResponse.json({ error: "Invalid review action." }, { status: 400 })
  }

  const [existingRows] = await pool.query(
    `
    SELECT id, status
    FROM onboarding_appointments
    WHERE id = ?
    LIMIT 1
  `,
    [appointmentId]
  )

  const existing = (existingRows as Array<{ id: string; status: string }>)[0]
  if (!existing) {
    return NextResponse.json({ error: "Appointment not found." }, { status: 404 })
  }

  if (
    (action === "approve" && existing.status !== "Pending") ||
    (action === "complete" && existing.status !== "Approved")
  ) {
    return NextResponse.json(
      {
        error:
          action === "approve"
            ? "Only pending appointments can be approved."
            : "Only approved appointments can be completed.",
      },
      { status: 409 }
    )
  }

  const status = action === "approve" ? "Approved" : "Completed"
  await pool.query(
    `
    UPDATE onboarding_appointments
    SET
      status = ?,
      decision_by_user_id = ?,
      decision_at = CURRENT_TIMESTAMP(3),
      decision_reason = ?,
      updated_at = CURRENT_TIMESTAMP(3)
    WHERE id = ?
      AND status = ?
  `,
    [
      status,
      auth.user.id,
      reason,
      appointmentId,
      action === "approve" ? "Pending" : "Approved",
    ]
  )

  const [rows] = await pool.query(
    `
    ${appointmentSelectSql}
    WHERE appointments.id = ?
    LIMIT 1
  `,
    [appointmentId]
  )

  const appointment = (rows as Parameters<typeof mapAppointment>[0][])[0]
  if (!appointment) {
    return NextResponse.json({ error: "Appointment not found." }, { status: 404 })
  }

  const attachmentsByAppointment = await fetchAppointmentAttachments(pool, [
    appointmentId,
  ])

  const mappedAppointment = mapAppointment(
    appointment,
    auth.user,
    attachmentsByAppointment.get(String(appointmentId)) ?? []
  )

  await syncOnboardingAppointmentToGoogleCalendar(pool, mappedAppointment)

  return NextResponse.json({ appointment: mappedAppointment })
}
