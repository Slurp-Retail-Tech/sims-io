import type { Pool, RowDataPacket } from "mysql2/promise"
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

type UserRow = RowDataPacket & {
  id: string
  name: string
  email: string
  role: string
  department: string
  status: "active" | "inactive"
  page_access: unknown
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

function parsePageAccess(value: unknown) {
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === "string")
  }

  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value)
      return Array.isArray(parsed)
        ? parsed.filter((item): item is string => typeof item === "string")
        : []
    } catch {
      return []
    }
  }

  return []
}

export async function resolveAuthUser(
  request: NextRequest,
  pool: Pool
): Promise<{ user: AuthUser } | { response: NextResponse }> {
  const sessionUser = await requireAuthenticatedUser(request)
  if (!sessionUser) {
    return {
      response: NextResponse.json({ error: "Unauthorized." }, { status: 401 }),
    }
  }

  const [rows] = await pool.query<UserRow[]>(
    `
    SELECT id, name, email, role, department, status, page_access
    FROM users
    WHERE id = ?
    LIMIT 1
  `,
    [sessionUser.id]
  )

  const user = rows[0]
  if (!user || user.status !== "active") {
    return {
      response: NextResponse.json({ error: "Unauthorized." }, { status: 401 }),
    }
  }

  const authUser: AuthUser = {
    id: String(user.id),
    name: user.name,
    email: user.email,
    role: user.role,
    department: user.department,
    pageAccess: parsePageAccess(user.page_access),
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
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    canEdit: canEditAppointment(currentUser, row),
    canComplete: canFinalize,
    canCancel: canFinalize,
  }
}

export function toSqlDateTime(value: Date) {
  return value.toISOString().slice(0, 23).replace("T", " ")
}
