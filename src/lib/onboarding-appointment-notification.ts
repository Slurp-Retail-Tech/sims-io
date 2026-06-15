import type { Pool, RowDataPacket } from "mysql2/promise"

import { APP_TIME_ZONE } from "./app-timezone.ts"

type SendMailInput = {
  to: string | string[]
  subject: string
  html: string
  text: string
}

export type OnboardingNotificationType =
  | "submitted"
  | "approved"
  | "completed"
  | "canceled"

export type OnboardingNotificationAppointment = {
  id: string
  outletName: string
  installationType: string
  scheduledAt: string
  scheduledEndAt: string
  paymentStatus: string
  status: string
  locationName?: string | null
  locationAddress?: string | null
  googleMapsUri?: string | null
  createdByName?: string | null
  createdByEmail?: string | null
  assignedMsUserName?: string | null
  assignedMsUserEmail?: string | null
  decisionByName?: string | null
  decisionByEmail?: string | null
  decisionReason?: string | null
  canceledByName?: string | null
  canceledByEmail?: string | null
  cancelReason?: string | null
}

export type OnboardingRecipientUser = {
  email: string | null
  department: string
  role: string
  status: string
}

export type OnboardingNotificationAppointmentRow = {
  id: string | number
  outlet_name: string
  installation_type: string
  scheduled_at: string
  scheduled_end_at: string
  payment_status: string
  status: string
  location_name?: string | null
  location_address?: string | null
  google_maps_uri?: string | null
  created_by_name?: string | null
  created_by_email?: string | null
  assigned_ms_user_name?: string | null
  assigned_ms_user_email?: string | null
  decision_by_name?: string | null
  decision_by_email?: string | null
  decision_reason?: string | null
  canceled_by_name?: string | null
  canceled_by_email?: string | null
  cancel_reason?: string | null
}

type SendOnboardingAppointmentNotificationInput = {
  type: OnboardingNotificationType
  appointment: OnboardingNotificationAppointment
  recipients: string[]
  sendMail?: (input: SendMailInput) => Promise<void>
}

type UserRecipientRow = RowDataPacket & OnboardingRecipientUser

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;")
}

function formatPerson(name?: string | null, email?: string | null) {
  if (name && email) return `${name} <${email}>`
  return name ?? email ?? "--"
}

function formatLocation(appointment: OnboardingNotificationAppointment) {
  const details = [appointment.locationName, appointment.locationAddress]
    .map((value) => value?.trim())
    .filter(Boolean)

  if (appointment.googleMapsUri) {
    details.push(appointment.googleMapsUri)
  }

  return details.length ? details.join("\n") : "--"
}

function parseAppointmentDate(value: string) {
  const normalized = /^\d{4}-\d{2}-\d{2}\s/.test(value)
    ? value.replace(" ", "T")
    : value
  const withZone = /[zZ]|[+-]\d{2}:?\d{2}$/.test(normalized)
    ? normalized
    : `${normalized}Z`
  const date = new Date(withZone)
  return Number.isNaN(date.valueOf()) ? null : date
}

function formatScheduledAt(value: string) {
  const date = parseAppointmentDate(value)
  if (!date) return value

  const formatted = new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone: APP_TIME_ZONE,
  }).format(date)

  return formatted.toLowerCase()
}

function formatScheduledRange(startValue: string, endValue: string) {
  const start = parseAppointmentDate(startValue)
  const end = parseAppointmentDate(endValue)
  if (!start || !end || end <= start) {
    return formatScheduledAt(startValue)
  }

  const datePart = new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: APP_TIME_ZONE,
  }).format(start)
  const startTime = new Intl.DateTimeFormat("en-GB", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone: APP_TIME_ZONE,
  }).format(start)
  const endTime = new Intl.DateTimeFormat("en-GB", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone: APP_TIME_ZONE,
  }).format(end)

  return `${datePart}, ${startTime} - ${endTime}`.toLowerCase()
}

function notificationTitle(type: OnboardingNotificationType) {
  if (type === "approved") return "Onboarding Approved"
  if (type === "completed") return "Onboarding Completed"
  if (type === "canceled") return "Onboarding Canceled"
  return "Onboarding Submitted"
}

function notificationSubject(type: OnboardingNotificationType, outletName: string) {
  return `${notificationTitle(type)} - ${outletName}`
}

export function buildOnboardingAppointmentEmail(
  type: OnboardingNotificationType,
  appointment: OnboardingNotificationAppointment
) {
  const fields = [
    ["Outlet", appointment.outletName],
    [
      "Scheduled",
      formatScheduledRange(appointment.scheduledAt, appointment.scheduledEndAt),
    ],
    ["Installation", appointment.installationType],
    ["Payment", appointment.paymentStatus],
    ["Status", appointment.status],
    ["Location", formatLocation(appointment)],
    ["Submitter", formatPerson(appointment.createdByName, appointment.createdByEmail)],
    [
      "Assigned MS PIC",
      formatPerson(appointment.assignedMsUserName, appointment.assignedMsUserEmail),
    ],
    ...(type === "canceled"
      ? [
          [
            "Canceled by",
            formatPerson(appointment.canceledByName, appointment.canceledByEmail),
          ],
          ["Cancellation reason", appointment.cancelReason ?? "--"],
        ]
      : [
          [
            "Updated by",
            formatPerson(appointment.decisionByName, appointment.decisionByEmail),
          ],
          ["Status note", appointment.decisionReason ?? "--"],
        ]),
    ["Appointment ID", appointment.id],
  ]

  const text = [
    `${notificationTitle(type)}: ${appointment.outletName}`,
    "",
    ...fields.map(([label, value]) => `${label}: ${value}`),
  ].join("\n")

  const rows = fields
    .map(
      ([label, value]) => `
        <tr>
          <td style="padding:10px 12px;border-bottom:1px solid #e5e7eb;width:160px;font-weight:600;color:#111827;vertical-align:top;">${escapeHtml(label)}</td>
          <td style="padding:10px 12px;border-bottom:1px solid #e5e7eb;color:#374151;white-space:pre-line;">${escapeHtml(value)}</td>
        </tr>
      `
    )
    .join("")

  return {
    subject: notificationSubject(type, appointment.outletName),
    text,
    html: `
      <div style="margin:0;padding:24px;background:#f3f4f6;font-family:Arial,sans-serif;color:#111827;">
        <div style="max-width:680px;margin:0 auto;background:#ffffff;border:1px solid #e5e7eb;border-radius:16px;overflow:hidden;">
          <div style="padding:20px 24px;background:#111827;color:#ffffff;">
            <div style="font-size:12px;letter-spacing:0.08em;text-transform:uppercase;opacity:0.8;">${escapeHtml(notificationTitle(type))}</div>
            <div style="margin-top:8px;font-size:24px;font-weight:700;line-height:1.2;">${escapeHtml(appointment.outletName)}</div>
          </div>
          <div style="padding:24px;">
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;">
              ${rows}
            </table>
          </div>
          <div style="padding:16px 24px;background:#f9fafb;border-top:1px solid #e5e7eb;font-size:12px;color:#6b7280;">
            Sent by SIMS Onboarding Schedule
          </div>
        </div>
      </div>
    `,
  }
}

export function mapOnboardingNotificationAppointment(
  row: OnboardingNotificationAppointmentRow
): OnboardingNotificationAppointment {
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
    googleMapsUri: row.google_maps_uri,
    createdByName: row.created_by_name,
    createdByEmail: row.created_by_email,
    assignedMsUserName: row.assigned_ms_user_name,
    assignedMsUserEmail: row.assigned_ms_user_email,
    decisionByName: row.decision_by_name,
    decisionByEmail: row.decision_by_email,
    decisionReason: row.decision_reason,
    canceledByName: row.canceled_by_name,
    canceledByEmail: row.canceled_by_email,
    cancelReason: row.cancel_reason,
  }
}

export function resolveOnboardingSubmissionRecipients(users: OnboardingRecipientUser[]) {
  const activeUsers = users.filter((user) => user.status === "active" && user.email)
  const msAdmins = activeUsers.filter(
    (user) => user.department === "Merchant Success" && user.role === "Admin"
  )
  const fallbackSuperAdmins = activeUsers.filter((user) => user.role === "Super Admin")
  const recipients = msAdmins.length > 0 ? msAdmins : fallbackSuperAdmins

  return Array.from(
    new Set(
      recipients
        .map((user) => user.email?.trim().toLowerCase())
        .filter((email): email is string => Boolean(email))
    )
  )
}

export async function fetchOnboardingSubmissionRecipients(pool: Pool) {
  const [rows] = await pool.query<UserRecipientRow[]>(
    `
    SELECT email, department, role, status
    FROM users
    WHERE status = 'active'
      AND (
        (department = 'Merchant Success' AND role = 'Admin')
        OR role = 'Super Admin'
      )
    ORDER BY name ASC
  `
  )

  return resolveOnboardingSubmissionRecipients(rows)
}

export async function sendOnboardingAppointmentNotification(
  input: SendOnboardingAppointmentNotificationInput
) {
  if (input.recipients.length === 0) {
    return { sent: false as const, reason: "no-recipients" as const }
  }

  const sendMail =
    input.sendMail ??
    (async (mailInput: SendMailInput) => {
      const mail = await import("@/lib/mail")
      await mail.sendMail(mailInput)
    })
  const email = buildOnboardingAppointmentEmail(input.type, input.appointment)

  try {
    await sendMail({
      to: input.recipients,
      subject: email.subject,
      html: email.html,
      text: email.text,
    })
    return { sent: true as const }
  } catch (error) {
    console.error("Failed to send onboarding appointment notification", error)
    return { sent: false as const, reason: "send-failed" as const }
  }
}
