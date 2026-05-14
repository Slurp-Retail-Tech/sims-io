import { NextRequest, NextResponse } from "next/server"
import type { ResultSetHeader } from "mysql2/promise"

import getPool from "@/lib/db"
import { parseDate } from "@/lib/dates"
import { syncOnboardingAppointmentToGoogleCalendar } from "@/lib/google-calendar"
import { getGooglePlacesConfig } from "@/lib/google-places"

import {
  appointmentSelectSql,
  cleanString,
  fetchAppointmentAttachments,
  isInstallationType,
  isPaymentStatus,
  mapAppointment,
  MAX_ATTACHMENT_COUNT,
  parseOptionalString,
  parseOptionalNumber,
  parseStringArray,
  resolveAuthUser,
  toSqlDateTime,
} from "./helpers"

export async function GET(request: NextRequest) {
  const pool = getPool()
  const auth = await resolveAuthUser(request)
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
    const validStatuses = statuses.filter((value) =>
      ["Pending", "Approved", "Completed"].includes(value)
    )
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
  const attachmentsByAppointment = await fetchAppointmentAttachments(
    pool,
    appointmentRows.map((row) => Number(row.id))
  )

  return NextResponse.json({
    appointments: appointmentRows.map((row) =>
      mapAppointment(
        row,
        auth.user,
        attachmentsByAppointment.get(String(row.id)) ?? []
      )
    ),
  })
}

export async function POST(request: NextRequest) {
  const pool = getPool()
  const auth = await resolveAuthUser(request)
  if ("response" in auth) {
    return auth.response
  }

  const body = (await request.json()) as {
    outletName?: unknown
    installationType?: unknown
    scheduledAt?: unknown
    paymentStatus?: unknown
    locationName?: unknown
    locationAddress?: unknown
    googlePlaceId?: unknown
    googleMapsUri?: unknown
    locationLat?: unknown
    locationLng?: unknown
    attachmentKeys?: unknown
    attachmentNames?: unknown
  }

  const outletName = cleanString(body.outletName)
  const installationType = cleanString(body.installationType)
  const scheduledAtRaw = cleanString(body.scheduledAt)
  const paymentStatus = cleanString(body.paymentStatus)
  const locationName = cleanString(body.locationName)
  const locationAddress = cleanString(body.locationAddress)
  const googlePlaceId = cleanString(body.googlePlaceId)
  const googleMapsUri = cleanString(body.googleMapsUri)
  const locationLat = parseOptionalNumber(body.locationLat)
  const locationLng = parseOptionalNumber(body.locationLng)
  const attachmentKeys = parseStringArray(body.attachmentKeys, MAX_ATTACHMENT_COUNT)
  const attachmentNamesInput = Array.isArray(body.attachmentNames)
    ? body.attachmentNames
    : []

  if (!outletName || !installationType || !scheduledAtRaw || !paymentStatus) {
    return NextResponse.json(
      { error: "Missing required appointment fields." },
      { status: 400 }
    )
  }

  if (!isInstallationType(installationType)) {
    return NextResponse.json(
      { error: "Invalid installation type." },
      { status: 400 }
    )
  }

  if (!isPaymentStatus(paymentStatus)) {
    return NextResponse.json(
      { error: "Invalid payment status." },
      { status: 400 }
    )
  }

  if (
    getGooglePlacesConfig().enabled &&
    installationType === "On-site" &&
    (!locationName || !locationAddress || !googlePlaceId)
  ) {
    return NextResponse.json(
      { error: "Location is required for on-site onboarding." },
      { status: 400 }
    )
  }

  const scheduledAt = parseDate(scheduledAtRaw)
  if (!scheduledAt) {
    return NextResponse.json({ error: "Invalid schedule date." }, { status: 400 })
  }

  const connection = await pool.getConnection()
  let appointmentId = 0
  try {
    await connection.beginTransaction()

    const [insertResult] = await connection.query<ResultSetHeader>(
      `
      INSERT INTO onboarding_appointments (
        outlet_name,
        installation_type,
        scheduled_at,
        payment_status,
        location_name,
        location_address,
        google_place_id,
        google_maps_uri,
        location_lat,
        location_lng,
        created_by_user_id
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
      [
        outletName,
        installationType,
        toSqlDateTime(scheduledAt),
        paymentStatus,
        locationName,
        locationAddress,
        googlePlaceId,
        googleMapsUri,
        locationLat,
        locationLng,
        auth.user.id,
      ]
    )

    appointmentId = Number(insertResult.insertId)

    if (attachmentKeys.length > 0) {
      for (let index = 0; index < attachmentKeys.length; index += 1) {
        const storageKey = attachmentKeys[index]
        const originalName = cleanString(attachmentNamesInput[index])

        await connection.query(
          `
          INSERT INTO onboarding_appointment_attachments (
            appointment_id,
            storage_key,
            original_name
          )
          VALUES (?, ?, ?)
        `,
          [appointmentId, storageKey, originalName]
        )
      }
    }

    await connection.commit()
  } catch (error) {
    await connection.rollback()
    throw error
  } finally {
    connection.release()
  }

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

  const attachmentsByAppointment = await fetchAppointmentAttachments(pool, [
    appointmentId,
  ])

  const mappedAppointment = mapAppointment(
    appointment,
    auth.user,
    attachmentsByAppointment.get(String(appointmentId)) ?? []
  )

  await syncOnboardingAppointmentToGoogleCalendar(pool, mappedAppointment)

  return NextResponse.json({ appointment: mappedAppointment }, { status: 201 })
}
