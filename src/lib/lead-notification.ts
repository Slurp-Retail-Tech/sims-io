import getPool from "@/lib/db"
import { APP_TIME_ZONE, parseDate } from "@/lib/dates"
import { sendMail } from "@/lib/mail"

export const LEAD_NOTIFICATION_SETTINGS_ID = 1
export const DEFAULT_LEAD_NOTIFICATION_SENDER = "marketing@leads.getslurp.com"

export type LeadNotificationSettings = {
  id: number
  isEnabled: boolean
  recipients: string[]
  updatedAt: string
  updatedBy: string | null
}

export type LeadNotificationLead = {
  id: string
  name: string
  telephone: string
  email: string
  businessName: string
  businessType: string
  businessLocation: string
  hubspotSyncStatus: "Pending" | "Success" | "Failed" | "Skipped"
  hubspotSyncError: string | null
  createdAt: string
}

type LeadNotificationSettingsRow = {
  id: number
  is_enabled: number
  sender_email: string
  recipients: string | null
  updated_at: string
  updated_by: string | null
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;")
}

export function isValidEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
}

export function parseLeadNotificationRecipients(value: string | null) {
  if (!value) {
    return []
  }

  return Array.from(
    new Set(
      value
        .split(/[\n,;]+/)
        .map((entry) => entry.trim().toLowerCase())
        .filter(Boolean)
    )
  )
}

export function serializeLeadNotificationRecipients(recipients: string[]) {
  return recipients.join(", ")
}

function mapLeadNotificationSettingsRow(row: LeadNotificationSettingsRow): LeadNotificationSettings {
  return {
    id: row.id,
    isEnabled: Boolean(row.is_enabled),
    recipients: parseLeadNotificationRecipients(row.recipients),
    updatedAt: row.updated_at,
    updatedBy: row.updated_by,
  }
}

export async function getLeadNotificationSettings() {
  const pool = getPool()
  const [rowsRaw] = await pool.query(
    `
      SELECT
        id,
        is_enabled,
        sender_email,
        recipients,
        updated_at,
        updated_by
      FROM lead_notification_settings
      WHERE id = ?
      LIMIT 1
    `,
    [LEAD_NOTIFICATION_SETTINGS_ID]
  )

  const row = (rowsRaw as LeadNotificationSettingsRow[])[0]
  if (row) {
    return mapLeadNotificationSettingsRow(row)
  }

  await pool.query(
    `
      INSERT INTO lead_notification_settings (id, is_enabled, sender_email, recipients)
      VALUES (?, TRUE, ?, NULL)
      ON DUPLICATE KEY UPDATE id = VALUES(id)
    `,
    [LEAD_NOTIFICATION_SETTINGS_ID, DEFAULT_LEAD_NOTIFICATION_SENDER]
  )

  return {
    id: LEAD_NOTIFICATION_SETTINGS_ID,
    isEnabled: true,
    recipients: [],
    updatedAt: new Date().toISOString(),
    updatedBy: null,
  }
}

export function formatLeadSubmittedAt(value: string) {
  const date = parseDate(value)
  if (!date) {
    return value
  }

  return new Intl.DateTimeFormat("en-MY", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: APP_TIME_ZONE,
  }).format(date)
}

function buildLeadNotificationHtml(lead: LeadNotificationLead) {
  const rows = [
    ["Lead name", lead.name],
    ["Submitted", formatLeadSubmittedAt(lead.createdAt)],
    ["Business", lead.businessName],
    ["Type", lead.businessType],
    ["Location", lead.businessLocation],
    ["Email", `<a href="mailto:${encodeURI(lead.email)}" style="color:#0f766e;text-decoration:none;">${escapeHtml(lead.email)}</a>`],
    ["Telephone", `<a href="tel:${encodeURI(lead.telephone)}" style="color:#0f766e;text-decoration:none;">${escapeHtml(lead.telephone)}</a>`],
    ["Lead ID", escapeHtml(lead.id)],
    ["HubSpot Status", escapeHtml(lead.hubspotSyncStatus)],
  ]

  if (lead.hubspotSyncStatus === "Failed" && lead.hubspotSyncError) {
    rows.push(["HubSpot Detail", escapeHtml(lead.hubspotSyncError)])
  }

  const tableRows = rows
    .map(
      ([label, value]) => `
        <tr>
          <td style="padding:10px 12px;border-bottom:1px solid #e5e7eb;width:160px;font-weight:600;color:#111827;vertical-align:top;">${label}</td>
          <td style="padding:10px 12px;border-bottom:1px solid #e5e7eb;color:#374151;">${value || "--"}</td>
        </tr>
      `
    )
    .join("")

  return `
    <div style="margin:0;padding:24px;background:#f3f4f6;font-family:Arial,sans-serif;color:#111827;">
      <div style="max-width:640px;margin:0 auto;background:#ffffff;border:1px solid #e5e7eb;border-radius:16px;overflow:hidden;">
        <div style="padding:20px 24px;background:#111827;color:#ffffff;">
          <div style="font-size:12px;letter-spacing:0.08em;text-transform:uppercase;opacity:0.8;">New Demo Lead</div>
          <div style="margin-top:8px;font-size:24px;font-weight:700;line-height:1.2;">${escapeHtml(lead.name)}</div>
        </div>
        <div style="padding:24px;">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;">
            ${tableRows}
          </table>
        </div>
        <div style="padding:16px 24px;background:#f9fafb;border-top:1px solid #e5e7eb;font-size:12px;color:#6b7280;">
          Sent by SIMS Lead Notification
        </div>
      </div>
    </div>
  `
}

function buildLeadNotificationText(lead: LeadNotificationLead) {
  const lines = [
    `New demo lead: ${lead.name}`,
    `Business: ${lead.businessName}`,
    `Type: ${lead.businessType}`,
    `Location: ${lead.businessLocation}`,
    `Email: ${lead.email}`,
    `Telephone: ${lead.telephone}`,
    `Lead ID: ${lead.id}`,
    `HubSpot Status: ${lead.hubspotSyncStatus}`,
  ]

  if (lead.hubspotSyncStatus === "Failed" && lead.hubspotSyncError) {
    lines.push(`HubSpot Detail: ${lead.hubspotSyncError}`)
  }

  return lines.join("\n")
}

export async function sendLeadNotificationEmail(lead: LeadNotificationLead) {
  const settings = await getLeadNotificationSettings()
  if (!settings.isEnabled || !settings.recipients.length) {
    return { sent: false, reason: "disabled-or-empty" as const }
  }

  await sendMail({
    to: settings.recipients,
    subject: `New Leads - ${lead.name}`,
    html: buildLeadNotificationHtml(lead),
    text: buildLeadNotificationText(lead),
  })

  return { sent: true as const }
}
