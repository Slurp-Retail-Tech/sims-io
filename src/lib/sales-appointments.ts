import type { Pool, ResultSetHeader, RowDataPacket } from "mysql2/promise"

import {
  syncSalesAppointmentToGoogleCalendar,
  type GoogleCalendarSyncResult,
  type SalesCalendarAppointment,
} from "./google-calendar.ts"

export type SalesAppointmentType = "Online" | "Physical"

export type CreateSalesAppointmentInput = {
  leadId: number | null
  customerName: string
  businessName: string
  businessType: string
  businessLocation: string
  appointmentType: SalesAppointmentType
  meetingLocation: string | null
  googlePlaceId: string | null
  googleMapsUri: string | null
  locationLat: number | null
  locationLng: number | null
  participantEmails: string[]
  scheduledAt: Date
  createdByUserId: string
}

export type CreateSalesAppointmentResult = {
  appointmentId: number
  calendarSync: GoogleCalendarSyncResult
}

export type SalesAppointmentCascadeResult =
  | { status: "updated" | "canceled"; calendarSync: GoogleCalendarSyncResult }
  | { status: "skipped"; reason: "not_found" | "not_pending" }

export type UpdateSalesAppointmentFromActivityInput = {
  scheduledAt: Date
  appointmentType: SalesAppointmentType
  meetingLocation: string | null
  googlePlaceId: string | null
  googleMapsUri: string | null
  locationLat: number | null
  locationLng: number | null
}

export type CancelSalesAppointmentInput = {
  canceledByUserId: string
  reason: string
}

const MAX_PARTICIPANT_EMAILS = 10
const PARTICIPANT_EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

type CalendarRow = RowDataPacket & {
  id: number
  customer_name: string
  business_name: string
  business_type: string
  business_location: string
  meeting_location: string | null
  google_maps_uri: string | null
  participant_emails: string | null
  google_meet_link: string | null
  appointment_type: SalesAppointmentType
  scheduled_at: string
  status: string
  cancel_reason: string | null
  completion_note: string | null
  google_calendar_id: string | null
  google_event_id: string | null
  created_by_name: string | null
  created_by_email: string | null
}

export function toSqlDateTime(value: Date): string {
  return value.toISOString().slice(0, 23).replace("T", " ")
}

/**
 * Normalizes participant emails from a comma-separated string or an array:
 * trims, lowercases, dedupes, drops invalid entries, and caps the list.
 */
export function parseParticipantEmails(value: unknown): string[] {
  const rawEntries = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(",")
      : []

  const seen = new Set<string>()
  const emails: string[] = []
  for (const entry of rawEntries) {
    if (typeof entry !== "string") {
      continue
    }
    const email = entry.trim().toLowerCase()
    if (!email || !PARTICIPANT_EMAIL_PATTERN.test(email) || seen.has(email)) {
      continue
    }
    seen.add(email)
    emails.push(email)
    if (emails.length >= MAX_PARTICIPANT_EMAILS) {
      break
    }
  }
  return emails
}

export function splitParticipantEmails(value: string | null): string[] {
  return value ? parseParticipantEmails(value) : []
}

export function mapSalesCalendarAppointment(
  row: CalendarRow
): SalesCalendarAppointment {
  return {
    id: String(row.id),
    customerName: row.customer_name,
    businessName: row.business_name,
    businessType: row.business_type,
    businessLocation: row.business_location,
    meetingLocation: row.meeting_location,
    appointmentType: row.appointment_type,
    scheduledAt: row.scheduled_at,
    status: row.status,
    createdByName: row.created_by_name,
    createdByEmail: row.created_by_email,
    participantEmails: splitParticipantEmails(row.participant_emails),
    googleMapsUri: row.google_maps_uri,
    googleMeetLink: row.google_meet_link,
    cancelReason: row.cancel_reason,
    completionNote: row.completion_note,
    googleCalendarId: row.google_calendar_id,
    googleEventId: row.google_event_id,
  }
}

export async function createSalesAppointment(
  pool: Pool,
  input: CreateSalesAppointmentInput
): Promise<CreateSalesAppointmentResult> {
  const isPhysical = input.appointmentType === "Physical"
  const participantEmails = isPhysical
    ? null
    : parseParticipantEmails(input.participantEmails).join(",") || null

  const [insertResult] = await pool.query<ResultSetHeader>(
    `
      INSERT INTO sales_appointments (
        lead_id,
        customer_name,
        business_name,
        business_type,
        business_location,
        meeting_location,
        google_place_id,
        google_maps_uri,
        location_lat,
        location_lng,
        participant_emails,
        appointment_type,
        scheduled_at,
        created_by_user_id
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    [
      input.leadId,
      input.customerName,
      input.businessName,
      input.businessType,
      input.businessLocation,
      isPhysical ? input.meetingLocation : null,
      isPhysical ? input.googlePlaceId : null,
      isPhysical ? input.googleMapsUri : null,
      isPhysical ? input.locationLat : null,
      isPhysical ? input.locationLng : null,
      participantEmails,
      input.appointmentType,
      toSqlDateTime(input.scheduledAt),
      input.createdByUserId,
    ]
  )

  const appointmentId = Number(insertResult.insertId)
  const calendarSync = await syncSalesAppointmentById(pool, appointmentId)

  return { appointmentId, calendarSync }
}

/**
 * Cascade from a lead Meeting activity edit. Only touches appointments that
 * are still Pending — the status guard lives in the UPDATE itself so
 * Completed/Canceled appointments are never modified, even in a race.
 */
export async function updateSalesAppointmentFromActivity(
  pool: Pool,
  appointmentId: number,
  input: UpdateSalesAppointmentFromActivityInput
): Promise<SalesAppointmentCascadeResult> {
  const isPhysical = input.appointmentType === "Physical"
  const [result] = await pool.query<ResultSetHeader>(
    `
    UPDATE sales_appointments
    SET
      scheduled_at = ?,
      appointment_type = ?,
      meeting_location = ?,
      google_place_id = ?,
      google_maps_uri = ?,
      location_lat = ?,
      location_lng = ?,
      participant_emails = IF(?, NULL, participant_emails),
      updated_at = CURRENT_TIMESTAMP(3)
    WHERE id = ?
      AND status = 'Pending'
  `,
    [
      toSqlDateTime(input.scheduledAt),
      input.appointmentType,
      isPhysical ? input.meetingLocation : null,
      isPhysical ? input.googlePlaceId : null,
      isPhysical ? input.googleMapsUri : null,
      isPhysical ? input.locationLat : null,
      isPhysical ? input.locationLng : null,
      isPhysical,
      appointmentId,
    ]
  )

  if (result.affectedRows === 0) {
    return { status: "skipped", reason: await resolveSkipReason(pool, appointmentId) }
  }

  const calendarSync = await syncSalesAppointmentById(pool, appointmentId)
  return { status: "updated", calendarSync }
}

/**
 * Cancels a Pending appointment (from the cancel route or an activity
 * cascade) and re-syncs its calendar event. Never touches non-Pending rows.
 */
export async function cancelSalesAppointment(
  pool: Pool,
  appointmentId: number,
  input: CancelSalesAppointmentInput
): Promise<SalesAppointmentCascadeResult> {
  const [result] = await pool.query<ResultSetHeader>(
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
    [input.canceledByUserId, input.reason, appointmentId]
  )

  if (result.affectedRows === 0) {
    return { status: "skipped", reason: await resolveSkipReason(pool, appointmentId) }
  }

  const calendarSync = await syncSalesAppointmentById(pool, appointmentId)
  return { status: "canceled", calendarSync }
}

async function resolveSkipReason(
  pool: Pool,
  appointmentId: number
): Promise<"not_found" | "not_pending"> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT id FROM sales_appointments WHERE id = ? LIMIT 1`,
    [appointmentId]
  )
  return rows.length > 0 ? "not_pending" : "not_found"
}

async function syncSalesAppointmentById(
  pool: Pool,
  appointmentId: number
): Promise<GoogleCalendarSyncResult> {
  try {
    const [rows] = await pool.query<CalendarRow[]>(
      `
      SELECT
        appointments.id,
        appointments.customer_name,
        appointments.business_name,
        appointments.business_type,
        appointments.business_location,
        appointments.meeting_location,
        appointments.google_maps_uri,
        appointments.participant_emails,
        appointments.google_meet_link,
        appointments.appointment_type,
        appointments.scheduled_at,
        appointments.status,
        appointments.cancel_reason,
        appointments.completion_note,
        appointments.google_calendar_id,
        appointments.google_event_id,
        created_by.name AS created_by_name,
        created_by.email AS created_by_email
      FROM sales_appointments AS appointments
      LEFT JOIN users AS created_by
        ON created_by.id = appointments.created_by_user_id
      WHERE appointments.id = ?
      LIMIT 1
    `,
      [appointmentId]
    )

    const row = rows[0]
    if (!row) {
      return { status: "failed", error: "Appointment not found" }
    }

    return await syncSalesAppointmentToGoogleCalendar(
      pool,
      mapSalesCalendarAppointment(row)
    )
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Google Calendar sync failed"
    console.error("Unable to sync sales appointment to Google Calendar", error)
    return { status: "failed", error: message }
  }
}
