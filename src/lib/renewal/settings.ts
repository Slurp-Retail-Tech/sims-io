/**
 * The renewal module's settings, as a single pinned row.
 *
 * Follows the convention every other settings table in this codebase uses
 * (`support_form_settings`, `lead_notification_settings`, `respondio_settings`):
 * one row at id 1, typed columns, in-code defaults covering a missing row so a
 * fresh environment works before anyone opens the settings page.
 *
 * Typed columns rather than key/value pairs, so a tax rate is a number and not
 * a string somebody has to parse and trust.
 */

import getPool, { type Queryable } from "../db.ts"
import type { ResultSetHeader, RowDataPacket } from "mysql2/promise"

import type { BillingTerm } from "./plan-resolution.ts"
import type { SettingsPatch } from "./settings-validation.ts"

export type RenewalSettings = {
  /** Days before expiry at which reminders fire. */
  reminderOffsets: number[]
  defaultBillingPlan: BillingTerm
  /** Percent, exclusive. Zero suppresses the tax line on documents. */
  taxRatePercent: number
  /** Absolute variance from catalog, in percent, that needs sign-off. */
  overrideVarianceThresholdPct: number
  graceWindowDays: number
  /**
   * Days ahead of expiry the nightly readiness sweep checks plan and PIC
   * eligibility, so gaps surface long before the first reminder offset.
   */
  readinessWindowDays: number
  /** Global kill switch for outbound messaging. */
  dispatchEnabled: boolean
  sendWindowStart: string
  sendWindowEnd: string
  sessionExpiryMinutes: number
  maxSessionRetries: number
  receiptPollCeilingSeconds: number
  respondioWhatsappChannelId: string | null
  bukkuDescriptionFormat: string | null
  updatedAt: string | null
}

/**
 * Defaults matching migration 030, so a missing row behaves like a fresh one.
 * `dispatchEnabled` is false: nothing reaches a merchant until someone turns
 * it on deliberately.
 */
export const DEFAULT_RENEWAL_SETTINGS: RenewalSettings = {
  reminderOffsets: [15, 5, 1],
  defaultBillingPlan: "annually",
  taxRatePercent: 0,
  overrideVarianceThresholdPct: 15,
  graceWindowDays: 30,
  readinessWindowDays: 30,
  dispatchEnabled: false,
  sendWindowStart: "09:00:00",
  sendWindowEnd: "18:00:00",
  sessionExpiryMinutes: 1440,
  maxSessionRetries: 3,
  receiptPollCeilingSeconds: 90,
  respondioWhatsappChannelId: null,
  bukkuDescriptionFormat: null,
  updatedAt: null,
}

type SettingsRow = RowDataPacket & {
  reminder_offsets_json: unknown
  default_billing_plan: BillingTerm
  tax_rate: string
  override_variance_threshold_pct: string
  grace_window_days: number
  readiness_window_days: number
  dispatch_enabled: number
  send_window_start: string
  send_window_end: string
  session_expiry_minutes: number
  max_session_retries: number
  receipt_poll_ceiling_seconds: number
  respondio_whatsapp_channel_id: string | null
  bukku_description_format: string | null
  updated_at: string | null
}

export async function loadRenewalSettings(
  db: Queryable = getPool()
): Promise<RenewalSettings> {
  const [rows] = await db.query<SettingsRow[]>(
    `SELECT reminder_offsets_json, default_billing_plan, tax_rate,
            override_variance_threshold_pct, grace_window_days,
            readiness_window_days, dispatch_enabled,
            send_window_start, send_window_end, session_expiry_minutes,
            max_session_retries, receipt_poll_ceiling_seconds,
            respondio_whatsapp_channel_id, bukku_description_format, updated_at
       FROM renewal_settings WHERE id = 1`
  )

  const row = rows[0]
  if (!row) {
    return { ...DEFAULT_RENEWAL_SETTINGS }
  }

  return {
    reminderOffsets: parseOffsets(row.reminder_offsets_json),
    defaultBillingPlan: row.default_billing_plan,
    taxRatePercent: Number(row.tax_rate),
    overrideVarianceThresholdPct: Number(row.override_variance_threshold_pct),
    graceWindowDays: row.grace_window_days,
    readinessWindowDays: Math.max(0, Number(row.readiness_window_days)),
    dispatchEnabled: row.dispatch_enabled === 1,
    sendWindowStart: row.send_window_start,
    sendWindowEnd: row.send_window_end,
    sessionExpiryMinutes: row.session_expiry_minutes,
    maxSessionRetries: row.max_session_retries,
    receiptPollCeilingSeconds: row.receipt_poll_ceiling_seconds,
    respondioWhatsappChannelId: row.respondio_whatsapp_channel_id,
    bukkuDescriptionFormat: row.bukku_description_format,
    updatedAt: row.updated_at,
  }
}

/**
 * Write a validated patch onto the singleton row.
 *
 * Column by column from the patch, so an untouched setting is never rewritten
 * and `updated_at` moves only when something changed. The row is created
 * first if a fresh environment has none.
 */
export async function saveRenewalSettings(
  patch: SettingsPatch,
  updatedByUserId: string | null,
  db: Queryable = getPool()
): Promise<void> {
  await ensureRenewalSettingsRow(db)

  const assignments: string[] = []
  const values: unknown[] = []

  const columns: Array<[keyof SettingsPatch, string, (value: never) => unknown]> = [
    ["reminderOffsets", "reminder_offsets_json", (value: number[]) => JSON.stringify(value)],
    ["readinessWindowDays", "readiness_window_days", (value: number) => value],
    ["defaultBillingPlan", "default_billing_plan", (value: string) => value],
    ["taxRatePercent", "tax_rate", (value: number) => value.toFixed(2)],
    ["overrideVarianceThresholdPct", "override_variance_threshold_pct", (value: number) => value.toFixed(2)],
    ["graceWindowDays", "grace_window_days", (value: number) => value],
    ["dispatchEnabled", "dispatch_enabled", (value: boolean) => (value ? 1 : 0)],
    ["sendWindowStart", "send_window_start", (value: string) => value],
    ["sendWindowEnd", "send_window_end", (value: string) => value],
    ["sessionExpiryMinutes", "session_expiry_minutes", (value: number) => value],
    ["maxSessionRetries", "max_session_retries", (value: number) => value],
    ["receiptPollCeilingSeconds", "receipt_poll_ceiling_seconds", (value: number) => value],
    ["respondioWhatsappChannelId", "respondio_whatsapp_channel_id", (value: string | null) => value],
    ["bukkuDescriptionFormat", "bukku_description_format", (value: string | null) => value],
  ]

  for (const [field, column, encode] of columns) {
    if (field in patch) {
      assignments.push(`${column} = ?`)
      values.push(encode(patch[field] as never))
    }
  }

  if (assignments.length === 0) {
    return
  }

  assignments.push("updated_by_user_id = ?")
  values.push(updatedByUserId)

  await db.query<ResultSetHeader>(
    `UPDATE renewal_settings SET ${assignments.join(", ")} WHERE id = 1`,
    values
  )
}

/** Ensure the singleton exists. Safe to call repeatedly. */
export async function ensureRenewalSettingsRow(
  db: Queryable = getPool()
): Promise<void> {
  await db.query<ResultSetHeader>(
    `INSERT INTO renewal_settings (id, reminder_offsets_json)
     VALUES (1, CAST('[15, 5, 1]' AS JSON))
     ON DUPLICATE KEY UPDATE id = VALUES(id)`
  )
}

/**
 * Read the offsets defensively.
 *
 * mysql2 may hand back a parsed array or the raw JSON string depending on the
 * column and driver version, and a hand-edited row could hold anything. A bad
 * value falls back to the default cadence rather than producing an empty one,
 * because an empty cadence silently means "never remind anybody".
 */
function parseOffsets(value: unknown): number[] {
  const raw =
    typeof value === "string"
      ? safeParseJson(value)
      : value

  if (!Array.isArray(raw)) {
    return [...DEFAULT_RENEWAL_SETTINGS.reminderOffsets]
  }

  const offsets = raw
    .map((entry) => Number(entry))
    .filter((entry) => Number.isInteger(entry) && entry >= 0)
    .sort((a, b) => b - a)

  return offsets.length > 0
    ? offsets
    : [...DEFAULT_RENEWAL_SETTINGS.reminderOffsets]
}

function safeParseJson(value: string): unknown {
  try {
    return JSON.parse(value)
  } catch {
    return null
  }
}
