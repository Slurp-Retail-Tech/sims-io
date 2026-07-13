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
  scheduledAt: Date
  createdByUserId: string
}

export type CreateSalesAppointmentResult = {
  appointmentId: number
  calendarSync: GoogleCalendarSyncResult
}

type CalendarRow = RowDataPacket & {
  id: number
  customer_name: string
  business_name: string
  business_type: string
  business_location: string
  meeting_location: string | null
  appointment_type: SalesAppointmentType
  scheduled_at: string
  status: string
  cancel_reason: string | null
  completion_note: string | null
  google_calendar_id: string | null
  google_event_id: string | null
  created_by_name: string | null
}

export function toSqlDateTime(value: Date): string {
  return value.toISOString().slice(0, 23).replace("T", " ")
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
      input.leadId,
      input.customerName,
      input.businessName,
      input.businessType,
      input.businessLocation,
      input.appointmentType === "Physical" ? input.meetingLocation : null,
      input.appointmentType,
      toSqlDateTime(input.scheduledAt),
      input.createdByUserId,
    ]
  )

  const appointmentId = Number(insertResult.insertId)
  const calendarSync = await syncCreatedSalesAppointment(pool, appointmentId)

  return { appointmentId, calendarSync }
}

async function syncCreatedSalesAppointment(
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
        appointments.appointment_type,
        appointments.scheduled_at,
        appointments.status,
        appointments.cancel_reason,
        appointments.completion_note,
        appointments.google_calendar_id,
        appointments.google_event_id,
        created_by.name AS created_by_name
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
      return { status: "failed", error: "Appointment not found after insert" }
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
