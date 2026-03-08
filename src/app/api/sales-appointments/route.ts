import { NextRequest, NextResponse } from "next/server"
import type { ResultSetHeader } from "mysql2/promise"

import getPool from "@/lib/db"
import { parseDate } from "@/lib/dates"

import {
  appointmentSelectSql,
  cleanString,
  isAppointmentStatus,
  isAppointmentType,
  mapAppointment,
  parseOptionalId,
  parseOptionalString,
  resolveAuthUser,
  toSqlDateTime,
} from "./helpers"

export async function GET(request: NextRequest) {
  const pool = getPool()
  const auth = await resolveAuthUser(request, pool)
  if ("response" in auth) {
    return auth.response
  }

  const start = parseOptionalString(request.nextUrl.searchParams.get("start"))
  const end = parseOptionalString(request.nextUrl.searchParams.get("end"))
  const statuses = request.nextUrl.searchParams
    .getAll("status")
    .map((value) => value.trim())
    .filter(Boolean)

  const conditions: string[] = []
  const values: Array<string> = []

  if (start) {
    const startDate = parseDate(start)
    if (!startDate) {
      return NextResponse.json({ error: "Invalid start date." }, { status: 400 })
    }
    conditions.push("appointments.scheduled_at >= ?")
    values.push(toSqlDateTime(startDate))
  }

  if (end) {
    const endDate = parseDate(end)
    if (!endDate) {
      return NextResponse.json({ error: "Invalid end date." }, { status: 400 })
    }
    conditions.push("appointments.scheduled_at <= ?")
    values.push(toSqlDateTime(endDate))
  }

  if (statuses.length > 0) {
    const validStatuses = statuses.filter(isAppointmentStatus)
    if (validStatuses.length === 0) {
      return NextResponse.json({ error: "Invalid status filter." }, { status: 400 })
    }
    conditions.push(
      `appointments.status IN (${validStatuses.map(() => "?").join(", ")})`
    )
    values.push(...validStatuses)
  }

  const whereClause = conditions.length
    ? `WHERE ${conditions.join(" AND ")}`
    : ""

  const [rows] = await pool.query(
    `
    ${appointmentSelectSql}
    ${whereClause}
    ORDER BY appointments.scheduled_at ASC, appointments.id ASC
  `,
    values
  )

  const appointmentRows = rows as Parameters<typeof mapAppointment>[0][]

  return NextResponse.json({
    appointments: appointmentRows.map((row) => mapAppointment(row, auth.user)),
  })
}

export async function POST(request: NextRequest) {
  const pool = getPool()
  const auth = await resolveAuthUser(request, pool)
  if ("response" in auth) {
    return auth.response
  }

  const body = (await request.json()) as {
    leadId?: unknown
    customerName?: unknown
    businessName?: unknown
    businessType?: unknown
    businessLocation?: unknown
    meetingLocation?: unknown
    appointmentType?: unknown
    scheduledAt?: unknown
  }

  const leadId = Object.hasOwn(body, "leadId") ? parseOptionalId(body.leadId) : null
  const customerName = cleanString(body.customerName)
  const businessName = cleanString(body.businessName)
  const businessType = cleanString(body.businessType)
  const businessLocation = cleanString(body.businessLocation)
  const meetingLocation = cleanString(body.meetingLocation)
  const appointmentType = cleanString(body.appointmentType)
  const scheduledAtRaw = cleanString(body.scheduledAt)

  if (
    !customerName ||
    !businessName ||
    !businessType ||
    !businessLocation ||
    !appointmentType ||
    !scheduledAtRaw
  ) {
    return NextResponse.json(
      { error: "Missing required appointment fields." },
      { status: 400 }
    )
  }

  if (!isAppointmentType(appointmentType)) {
    return NextResponse.json(
      { error: "Invalid appointment type." },
      { status: 400 }
    )
  }

  if (appointmentType === "Physical" && !meetingLocation) {
    return NextResponse.json(
      { error: "Meeting location is required for physical appointments." },
      { status: 400 }
    )
  }

  const scheduledAt = parseDate(scheduledAtRaw)
  if (!scheduledAt) {
    return NextResponse.json({ error: "Invalid schedule date." }, { status: 400 })
  }

  if (Object.hasOwn(body, "leadId") && body.leadId !== null && leadId === null) {
    return NextResponse.json({ error: "Invalid lead." }, { status: 400 })
  }

  if (leadId !== null) {
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
  }

  const [insertResult] = await pool.query<ResultSetHeader>(
    `
      INSERT INTO sales_appointments (
        lead_id,
        customer_name,
        business_name,
        business_type,
        business_location,
        meeting_location,
        appointment_type,
        scheduled_at,
        created_by_user_id
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    [
      leadId,
      customerName,
      businessName,
      businessType,
      businessLocation,
      appointmentType === "Physical" ? meetingLocation : null,
      appointmentType,
      toSqlDateTime(scheduledAt),
      auth.user.id,
    ]
  )

  const appointmentId = Number(insertResult.insertId)
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
    return NextResponse.json(
      { error: "Unable to create appointment." },
      { status: 500 }
    )
  }

  return NextResponse.json(
    { appointment: mapAppointment(appointment, auth.user) },
    { status: 201 }
  )
}
