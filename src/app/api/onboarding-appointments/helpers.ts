import type { Pool, RowDataPacket } from "mysql2/promise"
import { NextRequest, NextResponse } from "next/server"

import { requireAuthenticatedUser } from "@/lib/auth"
import {
  canCancelOnboardingAppointment,
  canEditOnboardingAppointment,
} from "@/lib/onboarding-appointment-access"
import { getProxyObjectUrl } from "@/lib/storage"

export const INSTALLATION_TYPES = ["Online", "On-site", "Support"] as const
export const PAYMENT_STATUSES = ["Pending", "Paid", "Unpaid"] as const
export const APPOINTMENT_STATUSES = [
  "Pending",
  "Approved",
  "Completed",
  "Canceled",
] as const
export const MAX_ATTACHMENT_COUNT = 10

export type InstallationType = (typeof INSTALLATION_TYPES)[number]
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number]
export type AppointmentStatus = (typeof APPOINTMENT_STATUSES)[number]

export type AuthUser = {
  id: string
  name: string
  email: string
  role: string
  department: string
}

export type AppointmentRow = RowDataPacket & {
  id: string
  outlet_name: string
  installation_type: InstallationType
  scheduled_at: string
  scheduled_end_at: string
  payment_status: PaymentStatus
  status: AppointmentStatus
  location_name: string | null
  location_address: string | null
  google_place_id: string | null
  google_maps_uri: string | null
  location_lat: string | number | null
  location_lng: string | number | null
  created_by_user_id: string
  decision_by_user_id: string | null
  decision_at: string | null
  decision_reason: string | null
  assigned_ms_user_id: string | null
  canceled_by_user_id: string | null
  canceled_at: string | null
  cancel_reason: string | null
  google_calendar_id: string | null
  google_event_id: string | null
  google_event_etag: string | null
  google_synced_at: string | null
  google_sync_status: "pending" | "synced" | "failed" | null
  google_sync_error: string | null
  created_at: string
  updated_at: string
  created_by_name: string | null
  created_by_email: string | null
  decision_by_name: string | null
  decision_by_email: string | null
  assigned_ms_user_name: string | null
  assigned_ms_user_email: string | null
  canceled_by_name: string | null
  canceled_by_email: string | null
}

export type AttachmentRow = RowDataPacket & {
  appointment_id: string
  storage_key: string
  original_name: string | null
}

export const appointmentSelectSql = `
  SELECT
    appointments.id,
    appointments.outlet_name,
    appointments.installation_type,
    appointments.scheduled_at,
    appointments.scheduled_end_at,
    appointments.payment_status,
    appointments.status,
    appointments.location_name,
    appointments.location_address,
    appointments.google_place_id,
    appointments.google_maps_uri,
    appointments.location_lat,
    appointments.location_lng,
    appointments.created_by_user_id,
    appointments.decision_by_user_id,
    appointments.decision_at,
    appointments.decision_reason,
    appointments.assigned_ms_user_id,
    appointments.canceled_by_user_id,
    appointments.canceled_at,
    appointments.cancel_reason,
    appointments.google_calendar_id,
    appointments.google_event_id,
    appointments.google_event_etag,
    appointments.google_synced_at,
    appointments.google_sync_status,
    appointments.google_sync_error,
    appointments.created_at,
    appointments.updated_at,
    created_by.name AS created_by_name,
    created_by.email AS created_by_email,
    decision_by.name AS decision_by_name,
    decision_by.email AS decision_by_email,
    assigned_ms_user.name AS assigned_ms_user_name,
    assigned_ms_user.email AS assigned_ms_user_email,
    canceled_by.name AS canceled_by_name,
    canceled_by.email AS canceled_by_email
  FROM onboarding_appointments AS appointments
  LEFT JOIN users AS created_by
    ON created_by.id = appointments.created_by_user_id
  LEFT JOIN users AS decision_by
    ON decision_by.id = appointments.decision_by_user_id
  LEFT JOIN users AS assigned_ms_user
    ON assigned_ms_user.id = appointments.assigned_ms_user_id
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

  return {
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      department: user.department,
    },
  }
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

export function parseStringArray(input: unknown, maxItems: number) {
  if (!Array.isArray(input)) {
    return []
  }

  const values = input
    .map((item) => cleanString(item))
    .filter((item): item is string => Boolean(item))

  return values.slice(0, maxItems)
}

export function parseOptionalNumber(value: unknown) {
  if (value === null || value === undefined || value === "") {
    return null
  }
  const parsed = typeof value === "number" ? value : Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

export function isInstallationType(value: string): value is InstallationType {
  return (INSTALLATION_TYPES as readonly string[]).includes(value)
}

export function isPaymentStatus(value: string): value is PaymentStatus {
  return (PAYMENT_STATUSES as readonly string[]).includes(value)
}

export function isAppointmentStatus(value: string): value is AppointmentStatus {
  return (APPOINTMENT_STATUSES as readonly string[]).includes(value)
}

export function isMerchantSuccessReviewer(user: AuthUser) {
  return user.department === "Merchant Success" || user.role === "Super Admin"
}

export function canEditAppointment(
  user: AuthUser,
  appointment: Pick<AppointmentRow, "created_by_user_id" | "assigned_ms_user_id">
) {
  return canEditOnboardingAppointment(user, appointment)
}

export function canAssignAppointment(
  user: AuthUser,
  appointment: Pick<AppointmentRow, "status">
) {
  return isMerchantSuccessReviewer(user) && appointment.status === "Approved"
}

export function canCancelAppointment(
  user: AuthUser,
  appointment: {
    created_by_user_id: string
    assigned_ms_user_id?: string | null
    status: string
  }
) {
  return canCancelOnboardingAppointment(user, appointment)
}

export async function fetchAppointmentAttachments(
  pool: Pool,
  appointmentIds: number[]
) {
  if (appointmentIds.length === 0) {
    return new Map<string, AttachmentRow[]>()
  }

  const placeholders = appointmentIds.map(() => "?").join(", ")
  const [rows] = await pool.query<AttachmentRow[]>(
    `
    SELECT appointment_id, storage_key, original_name
    FROM onboarding_appointment_attachments
    WHERE appointment_id IN (${placeholders})
    ORDER BY created_at ASC, id ASC
  `,
    appointmentIds
  )

  const attachmentsByAppointment = new Map<string, AttachmentRow[]>()
  for (const row of rows) {
    const key = String(row.appointment_id)
    const existing = attachmentsByAppointment.get(key)
    if (existing) {
      existing.push(row)
      continue
    }
    attachmentsByAppointment.set(key, [row])
  }
  return attachmentsByAppointment
}

export function mapAppointment(
  row: AppointmentRow,
  currentUser: AuthUser,
  attachments: AttachmentRow[]
) {
  const attachmentFiles = attachments.map((attachment) => ({
    key: attachment.storage_key,
    name:
      attachment.original_name ??
      attachment.storage_key.split("/").filter(Boolean).pop() ??
      "attachment",
    url: getProxyObjectUrl(attachment.storage_key),
  }))

  return {
    id: String(row.id),
    outletName: row.outlet_name,
    installationType: row.installation_type,
    scheduledAt: row.scheduled_at,
    scheduledEndAt: row.scheduled_end_at,
    paymentStatus: row.payment_status,
    status: row.status,
    locationName: row.location_name,
    locationAddress: row.location_address,
    googlePlaceId: row.google_place_id,
    googleMapsUri: row.google_maps_uri,
    locationLat: row.location_lat === null ? null : Number(row.location_lat),
    locationLng: row.location_lng === null ? null : Number(row.location_lng),
    createdByUserId: String(row.created_by_user_id),
    createdByName: row.created_by_name,
    decisionByUserId: row.decision_by_user_id
      ? String(row.decision_by_user_id)
      : null,
    decisionByName: row.decision_by_name,
    decisionAt: row.decision_at,
    decisionReason: row.decision_reason,
    assignedMsUserId: row.assigned_ms_user_id
      ? String(row.assigned_ms_user_id)
      : null,
    assignedMsUserName: row.assigned_ms_user_name,
    canceledByUserId: row.canceled_by_user_id
      ? String(row.canceled_by_user_id)
      : null,
    canceledByName: row.canceled_by_name,
    canceledAt: row.canceled_at,
    cancelReason: row.cancel_reason,
    googleCalendarId: row.google_calendar_id,
    googleEventId: row.google_event_id,
    googleEventEtag: row.google_event_etag,
    googleSyncedAt: row.google_synced_at,
    googleSyncStatus: row.google_sync_status,
    googleSyncError: row.google_sync_error,
    attachments: attachmentFiles.map((attachment) => attachment.url),
    attachmentFiles,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    canEdit: canEditAppointment(currentUser, row),
    canReview: isMerchantSuccessReviewer(currentUser),
    canAssign: canAssignAppointment(currentUser, row),
    canCancel: canCancelAppointment(currentUser, row),
  }
}

export function toSqlDateTime(value: Date) {
  return value.toISOString().slice(0, 23).replace("T", " ")
}
