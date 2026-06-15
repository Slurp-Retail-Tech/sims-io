import { NextRequest, NextResponse } from "next/server"

import getPool from "@/lib/db"
import { syncOnboardingAppointmentToGoogleCalendar } from "@/lib/google-calendar"
import {
  mapOnboardingNotificationAppointment,
  sendOnboardingAppointmentNotification,
} from "@/lib/onboarding-appointment-notification"

import {
  appointmentSelectSql,
  canCancelAppointment,
  fetchAppointmentAttachments,
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

  const { appointmentId: rawAppointmentId } = await context.params
  const appointmentId = parseAppointmentId(rawAppointmentId)
  if (!appointmentId) {
    return NextResponse.json({ error: "Invalid appointment id." }, { status: 400 })
  }

  const body = (await request.json()) as { reason?: unknown }
  const reason =
    typeof body.reason === "string" && body.reason.trim() ? body.reason.trim() : null
  if (!reason) {
    return NextResponse.json(
      { error: "A cancellation reason is required." },
      { status: 400 }
    )
  }

  const [existingRows] = await pool.query(
    `
    SELECT id, status, created_by_user_id, assigned_ms_user_id
    FROM onboarding_appointments
    WHERE id = ?
    LIMIT 1
  `,
    [appointmentId]
  )

  const existing = (
    existingRows as Array<{
      id: string
      status: string
      created_by_user_id: string
      assigned_ms_user_id: string | null
    }>
  )[0]
  if (!existing) {
    return NextResponse.json({ error: "Appointment not found." }, { status: 404 })
  }

  if (!canCancelAppointment(auth.user, existing)) {
    return NextResponse.json({ error: "Forbidden." }, { status: 403 })
  }

  if (existing.status !== "Pending" && existing.status !== "Approved") {
    return NextResponse.json(
      { error: "Only pending or approved appointments can be canceled." },
      { status: 409 }
    )
  }

  await pool.query(
    `
    UPDATE onboarding_appointments
    SET
      status = 'Canceled',
      canceled_by_user_id = ?,
      canceled_at = CURRENT_TIMESTAMP(3),
      cancel_reason = ?,
      updated_at = CURRENT_TIMESTAMP(3)
    WHERE id = ?
      AND status IN ('Pending', 'Approved')
  `,
    [auth.user.id, reason, appointmentId]
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

  const notificationAppointment = mapOnboardingNotificationAppointment(appointment)
  const recipients = Array.from(
    new Set(
      [
        notificationAppointment.assignedMsUserEmail,
        notificationAppointment.createdByEmail,
      ]
        .map((email) => email?.trim().toLowerCase())
        .filter((email): email is string => Boolean(email))
    )
  )
  await sendOnboardingAppointmentNotification({
    type: "canceled",
    appointment: notificationAppointment,
    recipients,
  })

  return NextResponse.json({ appointment: mappedAppointment })
}
