import { NextRequest, NextResponse } from "next/server"

import getPool from "@/lib/db"
import {
  LEAD_NOTIFICATION_SETTINGS_ID,
  getLeadNotificationSettings,
  isValidEmail,
  parseLeadNotificationRecipients,
  serializeLeadNotificationRecipients,
} from "@/lib/lead-notification"

function isAdminRole(role: string | null | undefined) {
  return role === "Admin" || role === "Super Admin"
}

async function canManageLeadNotificationSettings(userId: string) {
  const pool = getPool()
  const [rows] = await pool.query(
    `
      SELECT role, status
      FROM users
      WHERE id = ?
      LIMIT 1
    `,
    [userId]
  )

  const user = (rows as Array<{ role: string; status: string }>)[0]
  return user?.status === "active" && isAdminRole(user.role)
}

export async function GET(request: NextRequest) {
  const userId = request.headers.get("x-user-id")?.trim()
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 })
  }

  const settings = await getLeadNotificationSettings()
  return NextResponse.json({
    settings: {
      ...settings,
      recipientsText: settings.recipients.join("\n"),
    },
  })
}

export async function PATCH(request: NextRequest) {
  const userId = request.headers.get("x-user-id")?.trim()
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 })
  }
  if (!(await canManageLeadNotificationSettings(userId))) {
    return NextResponse.json({ error: "Forbidden." }, { status: 403 })
  }

  const body = (await request.json()) as {
    isEnabled?: boolean
    recipients?: string
  }

  if (typeof body.isEnabled !== "boolean") {
    return NextResponse.json({ error: "Invalid notification status." }, { status: 400 })
  }

  const recipients = parseLeadNotificationRecipients(body.recipients ?? "")
  if (recipients.some((email) => !isValidEmail(email))) {
    return NextResponse.json({ error: "One or more recipient emails are invalid." }, { status: 400 })
  }

  const pool = getPool()
  await pool.query(
    `
      INSERT INTO lead_notification_settings (
        id,
        is_enabled,
        recipients,
        updated_by
      )
      VALUES (?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        is_enabled = VALUES(is_enabled),
        recipients = VALUES(recipients),
        updated_by = VALUES(updated_by),
        updated_at = CURRENT_TIMESTAMP(3)
    `,
    [
      LEAD_NOTIFICATION_SETTINGS_ID,
      body.isEnabled,
      serializeLeadNotificationRecipients(recipients) || null,
      userId,
    ]
  )

  const settings = await getLeadNotificationSettings()
  return NextResponse.json({
    settings: {
      ...settings,
      recipientsText: settings.recipients.join("\n"),
    },
  })
}
