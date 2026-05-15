import type { Pool } from "mysql2/promise"

import { APP_TIME_ZONE } from "./app-timezone.ts"

export type GoogleCalendarConfig =
  | { enabled: false }
  | {
      enabled: true
      calendarId: string
      auth:
        | { type: "access-token"; accessToken: string }
        | {
            type: "refresh-token"
            clientId: string
            clientSecret: string
            refreshToken: string
          }
    }

export type GoogleCalendarOAuthClientConfig = {
  enabled: boolean
  clientId: string
  clientSecret: string
  redirectUri: string
}

export type OnboardingCalendarAppointment = {
  id: string
  outletName: string
  installationType: string
  scheduledAt: string
  scheduledEndAt: string
  paymentStatus: string
  status: string
  createdByName: string | null
  decisionByName?: string | null
  decisionAt?: string | null
  decisionReason: string | null
  assignedMsUserName: string | null
  locationName?: string | null
  locationAddress?: string | null
  googleMapsUri?: string | null
  googleCalendarId?: string | null
  googleEventId?: string | null
}

export type GoogleCalendarEventPayload = {
  summary: string
  description: string
  start: {
    dateTime: string
    timeZone: string
  }
  end: {
    dateTime: string
    timeZone: string
  }
  location?: string
  extendedProperties: {
    private: {
      simsAppointmentId: string
    }
  }
}

type GoogleCalendarEventResponse = {
  id?: string
  etag?: string
}

const GOOGLE_CALENDAR_API_BASE_URL =
  "https://www.googleapis.com/calendar/v3/calendars"
const GOOGLE_OAUTH_TOKEN_URL = "https://oauth2.googleapis.com/token"
const MAX_SYNC_ERROR_LENGTH = 500
const ACCESS_TOKEN_CACHE_BUFFER_SECONDS = 60

let cachedOAuthAccessToken:
  | {
      cacheKey: string
      accessToken: string
      expiresAt: number
    }
  | null = null

function parseCalendarDate(value: string) {
  const trimmed = value.trim()
  if (!trimmed) {
    return null
  }
  let normalized = trimmed
  if (/^\d{4}-\d{2}-\d{2}\s/.test(normalized)) {
    normalized = normalized.replace(" ", "T")
  }
  const hasTimeZone = /[zZ]|[+-]\d{2}:?\d{2}$/.test(normalized)
  if (!hasTimeZone) {
    normalized = `${normalized}Z`
  }
  const date = new Date(normalized)
  return Number.isNaN(date.valueOf()) ? null : date
}

export function getGoogleCalendarConfig(): GoogleCalendarConfig {
  const enabled = process.env.GOOGLE_CALENDAR_ENABLED?.trim().toLowerCase()
  const calendarId = process.env.GOOGLE_CALENDAR_ID?.trim()
  const accessToken = process.env.GOOGLE_CALENDAR_ACCESS_TOKEN?.trim()
  const clientId = process.env.GOOGLE_CALENDAR_CLIENT_ID?.trim()
  const clientSecret = process.env.GOOGLE_CALENDAR_CLIENT_SECRET?.trim()
  const refreshToken = process.env.GOOGLE_CALENDAR_REFRESH_TOKEN?.trim()

  if (enabled !== "true" || !calendarId) {
    return { enabled: false }
  }

  if (clientId && clientSecret && refreshToken) {
    return {
      enabled: true,
      calendarId,
      auth: {
        type: "refresh-token",
        clientId,
        clientSecret,
        refreshToken,
      },
    }
  }

  if (accessToken) {
    return {
      enabled: true,
      calendarId,
      auth: { type: "access-token", accessToken },
    }
  }

  return { enabled: false }
}

export function getGoogleCalendarOAuthClientConfig(
  origin?: string
): GoogleCalendarOAuthClientConfig {
  const clientId =
    process.env.GOOGLE_CALENDAR_CLIENT_ID?.trim() ||
    process.env.GOOGLE_CLIENT_ID?.trim() ||
    ""
  const clientSecret =
    process.env.GOOGLE_CALENDAR_CLIENT_SECRET?.trim() ||
    process.env.GOOGLE_CLIENT_SECRET?.trim() ||
    ""
  const configuredRedirectUri =
    process.env.GOOGLE_CALENDAR_REDIRECT_URI?.trim() || ""
  const baseUrl =
    process.env.APP_BASE_URL?.trim() || origin || "http://localhost:3000"
  const redirectUri =
    configuredRedirectUri ||
    `${baseUrl.replace(/\/$/, "")}/api/google-calendar/oauth/callback`

  return {
    enabled: Boolean(clientId && clientSecret),
    clientId,
    clientSecret,
    redirectUri,
  }
}

function getOAuthAccessTokenCacheKey(
  auth: Extract<GoogleCalendarConfig, { enabled: true }>["auth"] & {
    type: "refresh-token"
  }
) {
  return `${auth.clientId}:${auth.refreshToken}`
}

export async function getGoogleCalendarAccessToken(
  config: Extract<GoogleCalendarConfig, { enabled: true }>
) {
  if (config.auth.type === "access-token") {
    return config.auth.accessToken
  }

  const cacheKey = getOAuthAccessTokenCacheKey(config.auth)
  const now = Date.now()
  if (
    cachedOAuthAccessToken &&
    cachedOAuthAccessToken.cacheKey === cacheKey &&
    cachedOAuthAccessToken.expiresAt > now
  ) {
    return cachedOAuthAccessToken.accessToken
  }

  const response = await fetch(GOOGLE_OAUTH_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      client_id: config.auth.clientId,
      client_secret: config.auth.clientSecret,
      refresh_token: config.auth.refreshToken,
    }),
    cache: "no-store",
  })

  const payload = await parseGoogleCalendarResponse(response)
  if (!response.ok) {
    throw new Error(
      getGoogleCalendarErrorMessage(payload) ||
        `Google Calendar OAuth refresh failed (${response.status})`
    )
  }

  const tokenPayload = payload as {
    access_token?: unknown
    expires_in?: unknown
  } | null
  if (typeof tokenPayload?.access_token !== "string" || !tokenPayload.access_token) {
    throw new Error("Google Calendar OAuth refresh did not return an access token")
  }

  const expiresInSeconds =
    typeof tokenPayload.expires_in === "number" ? tokenPayload.expires_in : 3600
  cachedOAuthAccessToken = {
    cacheKey,
    accessToken: tokenPayload.access_token,
    expiresAt:
      now +
      Math.max(expiresInSeconds - ACCESS_TOKEN_CACHE_BUFFER_SECONDS, 1) * 1000,
  }

  return tokenPayload.access_token
}

export function buildGoogleCalendarEventPayload(
  appointment: OnboardingCalendarAppointment
): GoogleCalendarEventPayload {
  const start = parseCalendarDate(appointment.scheduledAt)
  if (!start) {
    throw new Error("Appointment has an invalid schedule date")
  }

  const end = parseCalendarDate(appointment.scheduledEndAt)
  if (!end || end <= start) {
    throw new Error("Appointment has an invalid schedule end date")
  }
  const descriptionLines = [
    `SIMS appointment: ${appointment.id}`,
    `Status: ${appointment.status}`,
    `Payment: ${appointment.paymentStatus}`,
    `Created by: ${appointment.createdByName ?? "Unknown"}`,
    `Assigned MS: ${appointment.assignedMsUserName ?? "Unassigned"}`,
  ]

  if (appointment.decisionByName) {
    descriptionLines.push(`Decision by: ${appointment.decisionByName}`)
  }
  if (appointment.decisionAt) {
    descriptionLines.push(`Decision at: ${appointment.decisionAt}`)
  }
  if (appointment.decisionReason) {
    descriptionLines.push(`Decision notes: ${appointment.decisionReason}`)
  }
  if (appointment.googleMapsUri) {
    descriptionLines.push(`Google Maps: ${appointment.googleMapsUri}`)
  }

  const location = formatCalendarEventLocation(appointment)

  return {
    summary: `${appointment.installationType}: ${appointment.outletName}`,
    description: descriptionLines.join("\n"),
    start: {
      dateTime: start.toISOString(),
      timeZone: APP_TIME_ZONE,
    },
    end: {
      dateTime: end.toISOString(),
      timeZone: APP_TIME_ZONE,
    },
    ...(location ? { location } : {}),
    extendedProperties: {
      private: {
        simsAppointmentId: appointment.id,
      },
    },
  }
}

function formatCalendarEventLocation(appointment: OnboardingCalendarAppointment) {
  const name = appointment.locationName?.trim()
  const address = appointment.locationAddress?.trim()
  if (name && address) {
    return `${name}, ${address}`
  }
  return address || name || null
}

async function parseGoogleCalendarResponse(response: Response) {
  try {
    return (await response.json()) as unknown
  } catch {
    return null
  }
}

function getGoogleCalendarErrorMessage(payload: unknown) {
  if (!payload || typeof payload !== "object") {
    return null
  }
  const record = payload as Record<string, unknown>
  const error = record.error
  if (typeof error === "string" && error.trim()) {
    return error.trim()
  }
  if (error && typeof error === "object") {
    const message = (error as Record<string, unknown>).message
    if (typeof message === "string" && message.trim()) {
      return message.trim()
    }
  }
  const message = record.message
  return typeof message === "string" && message.trim() ? message.trim() : null
}

function truncateSyncError(message: string) {
  return message.slice(0, MAX_SYNC_ERROR_LENGTH)
}

async function recordGoogleCalendarSyncStatus(
  pool: Pool,
  appointmentId: string,
  input:
    | {
        status: "synced"
        calendarId: string
        eventId: string
        eventEtag: string | null
      }
    | { status: "failed"; calendarId: string | null; error: string }
) {
  if (input.status === "synced") {
    await pool.query(
      `
      UPDATE onboarding_appointments
      SET
        google_calendar_id = ?,
        google_event_id = ?,
        google_event_etag = ?,
        google_synced_at = CURRENT_TIMESTAMP(3),
        google_sync_status = 'synced',
        google_sync_error = NULL,
        updated_at = CURRENT_TIMESTAMP(3)
      WHERE id = ?
    `,
      [input.calendarId, input.eventId, input.eventEtag, appointmentId]
    )
    return
  }

  await pool.query(
    `
    UPDATE onboarding_appointments
    SET
      google_calendar_id = COALESCE(?, google_calendar_id),
      google_sync_status = 'failed',
      google_sync_error = ?,
      updated_at = CURRENT_TIMESTAMP(3)
    WHERE id = ?
  `,
    [input.calendarId, truncateSyncError(input.error), appointmentId]
  )
}

async function tryRecordGoogleCalendarSyncStatus(
  pool: Pool,
  appointmentId: string,
  input: Parameters<typeof recordGoogleCalendarSyncStatus>[2]
) {
  try {
    await recordGoogleCalendarSyncStatus(pool, appointmentId, input)
  } catch (error) {
    console.error("Unable to record Google Calendar sync status", error)
  }
}

export async function syncOnboardingAppointmentToGoogleCalendar(
  pool: Pool,
  appointment: OnboardingCalendarAppointment
) {
  const config = getGoogleCalendarConfig()
  if (!config.enabled) {
    return { status: "disabled" as const }
  }

  try {
    const payload = buildGoogleCalendarEventPayload(appointment)
    const accessToken = await getGoogleCalendarAccessToken(config)
    const existingEventId = appointment.googleEventId?.trim()
    const method = existingEventId ? "PATCH" : "POST"
    const endpoint = existingEventId
      ? `${GOOGLE_CALENDAR_API_BASE_URL}/${encodeURIComponent(
          config.calendarId
        )}/events/${encodeURIComponent(existingEventId)}`
      : `${GOOGLE_CALENDAR_API_BASE_URL}/${encodeURIComponent(config.calendarId)}/events`

    const response = await fetch(endpoint, {
      method,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
      cache: "no-store",
    })

    const responsePayload = await parseGoogleCalendarResponse(response)
    if (!response.ok) {
      const message =
        getGoogleCalendarErrorMessage(responsePayload) ||
        `Google Calendar sync failed (${response.status})`
      await tryRecordGoogleCalendarSyncStatus(pool, appointment.id, {
        status: "failed",
        calendarId: config.calendarId,
        error: message,
      })
      return { status: "failed" as const, error: message }
    }

    const event = responsePayload as GoogleCalendarEventResponse | null
    const eventId = event?.id ?? existingEventId
    if (!eventId) {
      throw new Error("Google Calendar response did not include an event id")
    }

    await tryRecordGoogleCalendarSyncStatus(pool, appointment.id, {
      status: "synced",
      calendarId: config.calendarId,
      eventId,
      eventEtag: event?.etag ?? null,
    })
    return { status: "synced" as const, eventId }
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Google Calendar sync failed"
    await tryRecordGoogleCalendarSyncStatus(pool, appointment.id, {
      status: "failed",
      calendarId: config.calendarId,
      error: message,
    })
    return { status: "failed" as const, error: message }
  }
}
