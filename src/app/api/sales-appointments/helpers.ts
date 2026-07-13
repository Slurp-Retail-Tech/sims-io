import type { RowDataPacket } from "mysql2/promise"
import { NextRequest, NextResponse } from "next/server"

import { requireAuthenticatedUser } from "@/lib/auth"
import { hasPageAccessForPath } from "@/lib/page-access"

export const SALES_APPOINTMENT_TYPES = ["Online", "Physical"] as const
export const SALES_APPOINTMENT_STATUSES = [
  "Pending",
  "Completed",
  "Canceled",
] as const

export type SalesAppointmentType = (typeof SALES_APPOINTMENT_TYPES)[number]
export type SalesAppointmentStatus = (typeof SALES_APPOINTMENT_STATUSES)[number]

export type AuthUser = {
  id: string
  name: string
  email: string
  role: string
  department: string
  pageAccess: string[]
}

export type AppointmentRow = RowDataPacket & {
  id: string
  lead_id: string | null
  customer_name: string
  business_name: string
  business_type: string
  business_location: string
  meeting_location: string | null
  appointment_type: SalesAppointmentType
  scheduled_at: string
  status: SalesAppointmentStatus
  created_by_user_id: string
  completed_by_user_id: string | null
  completed_at: string | null
  completion_note: string | null
  canceled_by_user_id: string | null
  canceled_at: string | null
  cancel_reason: string | null
  google_calendar_id: string | null
  google_event_id: string | null
  created_at: string
  updated_at: string
  created_by_name: string | null
  completed_by_name: string | null
  canceled_by_name: string | null
}

export const appointmentSelectSql = `
  SELECT
    appointments.id,
    appointments.lead_id,
    appointments.customer_name,
    appointments.business_name,
    appointments.business_type,
    appointments.business_location,
    appointments.meeting_location,
    appointments.appointment_type,
    appointments.scheduled_at,
    appointments.status,
    appointments.created_by_user_id,
    appointments.completed_by_user_id,
    appointments.completed_at,
    appointments.completion_note,
    appointments.canceled_by_user_id,
    appointments.canceled_at,
    appointments.cancel_reason,
    appointments.google_calendar_id,
    appointments.google_event_id,
    appointments.created_at,
    appointments.updated_at,
    created_by.name AS created_by_name,
    completed_by.name AS completed_by_name,
    canceled_by.name AS canceled_by_name
  FROM sales_appointments AS appointments
  LEFT JOIN users AS created_by
    ON created_by.id = appointments.created_by_user_id
  LEFT JOIN users AS completed_by
    ON completed_by.id = appointments.completed_by_user_id
  LEFT JOIN users AS canceled_by
    ON canceled_by.id = appointments.canceled_by_user_id
`

export async function resolveAuthUser(
  request: NextRequest
): Promise<{ user: AuthUser } | { response: NextResponse }> {
  const user = await requireAuthenticatedUser(request)
  if (!user) {
    return {
      response: NextResponse.json({ error: "Unauthorized." }, { status: 401 }),
    }
  }

  const authUser: AuthUser = {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    department: user.department,
    pageAccess: user.pageAccess,
  }

  if (
    authUser.role !== "Super Admin" &&
    !hasPageAccessForPath("/sales/appointments", authUser.pageAccess)
  ) {
    return {
      response: NextResponse.json({ error: "Forbidden." }, { status: 403 }),
    }
  }

  return { user: authUser }
}

export function parseAppointmentId(value: string) {
  const parsed = Number.parseInt(value, 10)
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null
  }
  return parsed
}

export function cleanString(value: unknown) {
  if (typeof value !== "string") {
    return null
  }
  const trimmed = value.trim()
  return trimmed ? trimmed : null
}

export function parseOptionalString(value: unknown) {
  return cleanString(value)
}

export function parseOptionalId(value: unknown) {
  const cleaned = cleanString(value)
  if (!cleaned) {
    return null
  }

  const parsed = Number.parseInt(cleaned, 10)
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null
  }

  return parsed
}

export function isAppointmentType(value: string): value is SalesAppointmentType {
  return (SALES_APPOINTMENT_TYPES as readonly string[]).includes(value)
}

export function isAppointmentStatus(
  value: string
): value is SalesAppointmentStatus {
  return (SALES_APPOINTMENT_STATUSES as readonly string[]).includes(value)
}

export function canEditAppointment(
  user: AuthUser,
  appointment: Pick<AppointmentRow, "created_by_user_id" | "status">
) {
  return (
    String(appointment.created_by_user_id) === user.id &&
    appointment.status === "Pending"
  )
}

export function canFinalizeAppointment(
  appointment: Pick<AppointmentRow, "status">
) {
  return appointment.status === "Pending"
}

export function mapAppointment(row: AppointmentRow, currentUser: AuthUser) {
  const canFinalize = canFinalizeAppointment(row)

  return {
    id: String(row.id),
    leadId: row.lead_id ? String(row.lead_id) : null,
    customerName: row.customer_name,
    businessName: row.business_name,
    businessType: row.business_type,
    businessLocation: row.business_location,
    meetingLocation: row.meeting_location,
    appointmentType: row.appointment_type,
    scheduledAt: row.scheduled_at,
    status: row.status,
    createdByUserId: String(row.created_by_user_id),
    createdByName: row.created_by_name,
    completedByUserId: row.completed_by_user_id
      ? String(row.completed_by_user_id)
      : null,
    completedByName: row.completed_by_name,
    completedAt: row.completed_at,
    completionNote: row.completion_note,
    canceledByUserId: row.canceled_by_user_id
      ? String(row.canceled_by_user_id)
      : null,
    canceledByName: row.canceled_by_name,
    canceledAt: row.canceled_at,
    cancelReason: row.cancel_reason,
    googleCalendarId: row.google_calendar_id,
    googleEventId: row.google_event_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    canEdit: canEditAppointment(currentUser, row),
    canComplete: canFinalize,
    canCancel: canFinalize,
  }
}

export { toSqlDateTime } from "@/lib/sales-appointments"
