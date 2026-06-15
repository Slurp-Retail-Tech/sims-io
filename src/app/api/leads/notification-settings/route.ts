import { NextRequest, NextResponse } from "next/server"

import { requireAuthenticatedUser } from "@/lib/auth"
import getPool from "@/lib/db"
import {
  DEFAULT_LEAD_NOTIFICATION_SENDER,
  LEAD_NOTIFICATION_SETTINGS_ID,
  getLeadNotificationSettings,
  isValidEmail,
  parseLeadNotificationRecipients,
  serializeLeadNotificationRecipients,
} from "@/lib/lead-notification"

function isAdminRole(role: string | null | undefined) {
  return role === "Admin" || role === "Super Admin"
}

export async function GET(request: NextRequest) {
  const user = await requireAuthenticatedUser(request)
  if (!user) {
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
  const user = await requireAuthenticatedUser(request)
  if (!user) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 })
  }
  if (!isAdminRole(user.role)) {
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

  try {
    const pool = getPool()
    await pool.query(
      `
        INSERT INTO lead_notification_settings (
          id,
          is_enabled,
          sender_email,
          recipients,
          updated_by
        )
        VALUES (?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
          is_enabled = VALUES(is_enabled),
          recipients = VALUES(recipients),
          updated_by = VALUES(updated_by),
          updated_at = CURRENT_TIMESTAMP(3)
      `,
      [
        LEAD_NOTIFICATION_SETTINGS_ID,
        body.isEnabled,
        DEFAULT_LEAD_NOTIFICATION_SENDER,
        serializeLeadNotificationRecipients(recipients) || null,
        user.id,
      ]
    )

    const settings = await getLeadNotificationSettings()
    return NextResponse.json({
      settings: {
        ...settings,
        recipientsText: settings.recipients.join("\n"),
      },
    })
  } catch (error) {
    console.error("Failed to save lead notification settings:", error)
    return NextResponse.json(
      { error: "Failed to save notification settings. Please try again." },
      { status: 500 }
    )
  }
}
