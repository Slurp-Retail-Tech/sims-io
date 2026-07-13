import type { RowDataPacket } from "mysql2/promise"
import { NextRequest, NextResponse } from "next/server"

import getPool from "@/lib/db"
import { cancelSalesAppointment } from "@/lib/sales-appointments"

import {
  type AppointmentRow,
  appointmentSelectSql,
  canFinalizeAppointment,
  cleanString,
  isAppointmentStatus,
  mapAppointment,
  parseAppointmentId,
  resolveAuthUser,
} from "../../helpers"

type ExistingAppointmentRow = RowDataPacket & Pick<AppointmentRow, "id" | "status">

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
  const reason = cleanString(body.reason)
  if (!reason) {
    return NextResponse.json(
      { error: "Cancellation reason is required." },
      { status: 400 }
    )
  }

  const [existingRows] = await pool.query<ExistingAppointmentRow[]>(
    `
    SELECT id, status
    FROM sales_appointments
    WHERE id = ?
    LIMIT 1
  `,
    [appointmentId]
  )

  const existing = existingRows[0]
  if (!existing) {
    return NextResponse.json({ error: "Appointment not found." }, { status: 404 })
  }

  if (!isAppointmentStatus(existing.status)) {
    return NextResponse.json(
      { error: "Appointment has an invalid status." },
      { status: 500 }
    )
  }

  if (!canFinalizeAppointment(existing)) {
    return NextResponse.json(
      { error: "Only pending appointments can be canceled." },
      { status: 409 }
    )
  }

  // Shared cancel path (also used by lead-activity cascades): guarded
  // Pending-only UPDATE + calendar re-sync.
  await cancelSalesAppointment(pool, appointmentId, {
    canceledByUserId: auth.user.id,
    reason,
  })

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
