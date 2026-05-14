import { NextRequest, NextResponse } from "next/server"
import type { RowDataPacket } from "mysql2/promise"

import getPool from "@/lib/db"
import { parseDate } from "@/lib/dates"
import { syncOnboardingAppointmentToGoogleCalendar } from "@/lib/google-calendar"
import { getGooglePlacesConfig } from "@/lib/google-places"

import {
  appointmentSelectSql,
  canAssignAppointment,
  canEditAppointment,
  cleanString,
  fetchAppointmentAttachments,
  isInstallationType,
  isPaymentStatus,
  mapAppointment,
  MAX_ATTACHMENT_COUNT,
  parseAppointmentId,
  parseOptionalNumber,
  parseStringArray,
  resolveAuthUser,
  toSqlDateTime,
} from "../helpers"

async function loadAppointment(pool: ReturnType<typeof getPool>, appointmentId: number) {
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
    return null
  }

  const attachmentsByAppointment = await fetchAppointmentAttachments(pool, [
    appointmentId,
  ])

  return {
    appointment,
    attachments: attachmentsByAppointment.get(String(appointmentId)) ?? [],
  }
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

  const loaded = await loadAppointment(pool, appointmentId)
  if (!loaded) {
    return NextResponse.json({ error: "Appointment not found." }, { status: 404 })
  }

  return NextResponse.json({
    appointment: mapAppointment(loaded.appointment, auth.user, loaded.attachments),
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
    existingAttachmentKeys?: unknown
    newAttachmentKeys?: unknown
    newAttachmentNames?: unknown
    assignedMsUserId?: unknown
  }

  const wantsAssignment = Object.hasOwn(body, "assignedMsUserId")
  const hasLocationEdits =
    Object.hasOwn(body, "locationName") ||
    Object.hasOwn(body, "locationAddress") ||
    Object.hasOwn(body, "googlePlaceId") ||
    Object.hasOwn(body, "googleMapsUri") ||
    Object.hasOwn(body, "locationLat") ||
    Object.hasOwn(body, "locationLng")
  const hasFieldEdits =
    Object.hasOwn(body, "outletName") ||
    Object.hasOwn(body, "installationType") ||
    Object.hasOwn(body, "scheduledAt") ||
    Object.hasOwn(body, "paymentStatus") ||
    hasLocationEdits ||
    Object.hasOwn(body, "existingAttachmentKeys") ||
    Object.hasOwn(body, "newAttachmentKeys")

  if (hasFieldEdits && !canEditAppointment(auth.user, loaded.appointment)) {
    return NextResponse.json({ error: "Forbidden." }, { status: 403 })
  }

  if (wantsAssignment && !canAssignAppointment(auth.user, loaded.appointment)) {
    return NextResponse.json({ error: "Forbidden." }, { status: 403 })
  }

  const updates: string[] = []
  const params: Array<string | number | null> = []
  let nextInstallationType = loaded.appointment.installation_type
  let nextLocationName = loaded.appointment.location_name
  let nextLocationAddress = loaded.appointment.location_address
  let nextGooglePlaceId = loaded.appointment.google_place_id

  if (Object.hasOwn(body, "outletName")) {
    const outletName = cleanString(body.outletName)
    if (!outletName) {
      return NextResponse.json({ error: "Outlet name is required." }, { status: 400 })
    }
    updates.push("outlet_name = ?")
    params.push(outletName)
  }

  if (Object.hasOwn(body, "installationType")) {
    const installationType = cleanString(body.installationType)
    if (!installationType || !isInstallationType(installationType)) {
      return NextResponse.json(
        { error: "Invalid installation type." },
        { status: 400 }
      )
    }
    updates.push("installation_type = ?")
    params.push(installationType)
    nextInstallationType = installationType
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

  if (Object.hasOwn(body, "paymentStatus")) {
    const paymentStatus = cleanString(body.paymentStatus)
    if (!paymentStatus || !isPaymentStatus(paymentStatus)) {
      return NextResponse.json(
        { error: "Invalid payment status." },
        { status: 400 }
      )
    }
    updates.push("payment_status = ?")
    params.push(paymentStatus)
  }

  if (Object.hasOwn(body, "locationName")) {
    nextLocationName = cleanString(body.locationName)
    updates.push("location_name = ?")
    params.push(nextLocationName)
  }

  if (Object.hasOwn(body, "locationAddress")) {
    nextLocationAddress = cleanString(body.locationAddress)
    updates.push("location_address = ?")
    params.push(nextLocationAddress)
  }

  if (Object.hasOwn(body, "googlePlaceId")) {
    nextGooglePlaceId = cleanString(body.googlePlaceId)
    updates.push("google_place_id = ?")
    params.push(nextGooglePlaceId)
  }

  if (Object.hasOwn(body, "googleMapsUri")) {
    updates.push("google_maps_uri = ?")
    params.push(cleanString(body.googleMapsUri))
  }

  if (Object.hasOwn(body, "locationLat")) {
    updates.push("location_lat = ?")
    params.push(parseOptionalNumber(body.locationLat))
  }

  if (Object.hasOwn(body, "locationLng")) {
    updates.push("location_lng = ?")
    params.push(parseOptionalNumber(body.locationLng))
  }

  if (
    (Object.hasOwn(body, "installationType") || hasLocationEdits) &&
    getGooglePlacesConfig().enabled &&
    nextInstallationType === "On-site" &&
    (!nextLocationName || !nextLocationAddress || !nextGooglePlaceId)
  ) {
    return NextResponse.json(
      { error: "Location is required for on-site onboarding." },
      { status: 400 }
    )
  }

  if (wantsAssignment) {
    const assignedMsUserId = cleanString(body.assignedMsUserId)
    if (assignedMsUserId) {
      const [rows] = await pool.query<
        Array<
          RowDataPacket & {
            id: string
            department: string
            status: "active" | "inactive"
          }
        >
      >(
        `
        SELECT id, department, status
        FROM users
        WHERE id = ?
        LIMIT 1
      `,
        [assignedMsUserId]
      )
      const assignee = rows[0]
      if (
        !assignee ||
        assignee.status !== "active" ||
        assignee.department !== "Merchant Success"
      ) {
        return NextResponse.json(
          { error: "Assignee must be an active Merchant Success user." },
          { status: 400 }
        )
      }
      updates.push("assigned_ms_user_id = ?")
      params.push(assignedMsUserId)
    } else {
      updates.push("assigned_ms_user_id = NULL")
    }
  }

  if (!hasFieldEdits && !wantsAssignment) {
    return NextResponse.json({ error: "No changes requested." }, { status: 400 })
  }

  const shouldUpdateAttachments =
    Object.hasOwn(body, "existingAttachmentKeys") ||
    Object.hasOwn(body, "newAttachmentKeys")
  const existingAttachmentKeys = shouldUpdateAttachments
    ? parseStringArray(body.existingAttachmentKeys, MAX_ATTACHMENT_COUNT)
    : []
  const newAttachmentKeys = shouldUpdateAttachments
    ? parseStringArray(body.newAttachmentKeys, MAX_ATTACHMENT_COUNT)
    : []
  const newAttachmentNames = Array.isArray(body.newAttachmentNames)
    ? body.newAttachmentNames
    : []

  if (shouldUpdateAttachments) {
    const nextAttachmentKeys = [...existingAttachmentKeys, ...newAttachmentKeys]

    if (nextAttachmentKeys.length > MAX_ATTACHMENT_COUNT) {
      return NextResponse.json(
        { error: `You can upload up to ${MAX_ATTACHMENT_COUNT} files.` },
        { status: 400 }
      )
    }

    const existingKeys = new Set(
      loaded.attachments.map((attachment) => attachment.storage_key)
    )
    for (const key of existingAttachmentKeys) {
      if (!existingKeys.has(key)) {
        return NextResponse.json(
          { error: "One or more attachments do not belong to this appointment." },
          { status: 400 }
        )
      }
    }
  }

  const connection = await pool.getConnection()
  try {
    await connection.beginTransaction()

    if (updates.length > 0) {
      await connection.query(
        `
        UPDATE onboarding_appointments
        SET ${updates.join(", ")}, updated_at = CURRENT_TIMESTAMP(3)
        WHERE id = ?
      `,
        [...params, String(appointmentId)]
      )
    }

    if (shouldUpdateAttachments) {
      await connection.query(
        `
        DELETE FROM onboarding_appointment_attachments
        WHERE appointment_id = ?
      `,
        [appointmentId]
      )

      for (const attachment of loaded.attachments) {
        if (!existingAttachmentKeys.includes(attachment.storage_key)) {
          continue
        }
        await connection.query(
          `
          INSERT INTO onboarding_appointment_attachments (
            appointment_id,
            storage_key,
            original_name
          )
          VALUES (?, ?, ?)
        `,
          [appointmentId, attachment.storage_key, attachment.original_name]
        )
      }

      for (let index = 0; index < newAttachmentKeys.length; index += 1) {
        await connection.query(
          `
          INSERT INTO onboarding_appointment_attachments (
            appointment_id,
            storage_key,
            original_name
          )
          VALUES (?, ?, ?)
        `,
          [
            appointmentId,
            newAttachmentKeys[index],
            cleanString(newAttachmentNames[index]),
          ]
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

  const refreshed = await loadAppointment(pool, appointmentId)
  if (!refreshed) {
    return NextResponse.json({ error: "Appointment not found." }, { status: 404 })
  }

  const mappedAppointment = mapAppointment(
    refreshed.appointment,
    auth.user,
    refreshed.attachments
  )

  await syncOnboardingAppointmentToGoogleCalendar(pool, mappedAppointment)

  return NextResponse.json({ appointment: mappedAppointment })
}
