import { NextRequest, NextResponse } from "next/server"

import getPool from "@/lib/db"

import {
  appointmentSelectSql,
  canFinalizeAppointment,
  cleanString,
  mapAppointment,
  parseAppointmentId,
  resolveAuthUser,
} from "../../helpers"

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ appointmentId: string }> }
) {
  const pool = getPool()
  const auth = await resolveAuthUser(request, pool)
  if ("response" in auth) {
    return auth.response
  }

  const { appointmentId: rawAppointmentId } = await context.params
  const appointmentId = parseAppointmentId(rawAppointmentId)
  if (!appointmentId) {
    return NextResponse.json({ error: "Invalid appointment id." }, { status: 400 })
  }

  const body = (await request.json()) as { reason?: unknown }
  const reason = cleanString(body.reason)
  if (!reason) {
    return NextResponse.json(
      { error: "Cancellation reason is required." },
      { status: 400 }
    )
  }

  const [existingRows] = await pool.query(
    `
    SELECT id, status
    FROM sales_appointments
    WHERE id = ?
    LIMIT 1
  `,
    [appointmentId]
  )

  const existing = (existingRows as Array<{ id: string; status: string }>)[0]
  if (!existing) {
    return NextResponse.json({ error: "Appointment not found." }, { status: 404 })
  }

  if (!canFinalizeAppointment(existing)) {
    return NextResponse.json(
      { error: "Only pending appointments can be canceled." },
      { status: 409 }
    )
  }

  await pool.query(
    `
    UPDATE sales_appointments
    SET
      status = 'Canceled',
      canceled_by_user_id = ?,
      canceled_at = CURRENT_TIMESTAMP(3),
      cancel_reason = ?,
      updated_at = CURRENT_TIMESTAMP(3)
    WHERE id = ?
      AND status = 'Pending'
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

  return NextResponse.json({
    appointment: mapAppointment(appointment, auth.user),
  })
}
