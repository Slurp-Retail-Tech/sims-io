import assert from "node:assert/strict"
import test from "node:test"

import {
  buildGoogleCalendarEventPayload,
  getGoogleCalendarAccessToken,
  getGoogleCalendarConfig,
  syncOnboardingAppointmentToGoogleCalendar,
} from "./google-calendar.ts"

test("builds onboarding event payload with the SIMS title format and 3 hour duration", () => {
  const payload = buildGoogleCalendarEventPayload({
    id: "42",
    outletName: "KLCC Outlet",
    installationType: "On-site",
    scheduledAt: "2026-05-14 01:30:00.000",
    paymentStatus: "Paid",
    status: "Approved",
    createdByName: "Aina",
    assignedMsUserName: "Mei",
    decisionReason: "Ready for install",
  })

  assert.equal(payload.summary, "On-site: KLCC Outlet")
  assert.deepEqual(payload.start, {
    dateTime: "2026-05-14T01:30:00.000Z",
    timeZone: "Asia/Kuala_Lumpur",
  })
  assert.deepEqual(payload.end, {
    dateTime: "2026-05-14T04:30:00.000Z",
    timeZone: "Asia/Kuala_Lumpur",
  })
  assert.equal(payload.extendedProperties.private.simsAppointmentId, "42")
  assert.match(payload.description, /SIMS appointment: 42/)
  assert.match(payload.description, /Status: Approved/)
  assert.match(payload.description, /Payment: Paid/)
  assert.match(payload.description, /Assigned MS: Mei/)
})

test("adds selected Google Maps location to the Calendar event", () => {
  const payload = buildGoogleCalendarEventPayload({
    id: "42",
    outletName: "KLCC Outlet",
    installationType: "On-site",
    scheduledAt: "2026-05-14 01:30:00.000",
    paymentStatus: "Paid",
    status: "Approved",
    createdByName: "Aina",
    assignedMsUserName: "Mei",
    decisionReason: null,
    locationName: "Suria KLCC",
    locationAddress: "Kuala Lumpur City Centre, 50088 Kuala Lumpur",
    googleMapsUri: "https://maps.google.com/?cid=123",
  })

  assert.equal(
    payload.location,
    "Suria KLCC, Kuala Lumpur City Centre, 50088 Kuala Lumpur"
  )
  assert.match(payload.description, /Google Maps: https:\/\/maps\.google\.com\/\?cid=123/)
})

test("treats Google Calendar sync as disabled unless all required config is present", () => {
  const originalEnabled = process.env.GOOGLE_CALENDAR_ENABLED
  const originalCalendarId = process.env.GOOGLE_CALENDAR_ID
  const originalToken = process.env.GOOGLE_CALENDAR_ACCESS_TOKEN
  const originalClientId = process.env.GOOGLE_CALENDAR_CLIENT_ID
  const originalClientSecret = process.env.GOOGLE_CALENDAR_CLIENT_SECRET
  const originalRefreshToken = process.env.GOOGLE_CALENDAR_REFRESH_TOKEN

  try {
    process.env.GOOGLE_CALENDAR_ENABLED = "true"
    process.env.GOOGLE_CALENDAR_ID = "merchant-success@example.com"
    delete process.env.GOOGLE_CALENDAR_ACCESS_TOKEN
    delete process.env.GOOGLE_CALENDAR_CLIENT_ID
    delete process.env.GOOGLE_CALENDAR_CLIENT_SECRET
    delete process.env.GOOGLE_CALENDAR_REFRESH_TOKEN

    assert.deepEqual(getGoogleCalendarConfig(), { enabled: false })

    process.env.GOOGLE_CALENDAR_ACCESS_TOKEN = "access-token"
    assert.deepEqual(getGoogleCalendarConfig(), {
      enabled: true,
      calendarId: "merchant-success@example.com",
      auth: {
        type: "access-token",
        accessToken: "access-token",
      },
    })
  } finally {
    if (originalEnabled === undefined) delete process.env.GOOGLE_CALENDAR_ENABLED
    else process.env.GOOGLE_CALENDAR_ENABLED = originalEnabled

    if (originalCalendarId === undefined) delete process.env.GOOGLE_CALENDAR_ID
    else process.env.GOOGLE_CALENDAR_ID = originalCalendarId

    if (originalToken === undefined) delete process.env.GOOGLE_CALENDAR_ACCESS_TOKEN
    else process.env.GOOGLE_CALENDAR_ACCESS_TOKEN = originalToken

    if (originalClientId === undefined) delete process.env.GOOGLE_CALENDAR_CLIENT_ID
    else process.env.GOOGLE_CALENDAR_CLIENT_ID = originalClientId

    if (originalClientSecret === undefined) delete process.env.GOOGLE_CALENDAR_CLIENT_SECRET
    else process.env.GOOGLE_CALENDAR_CLIENT_SECRET = originalClientSecret

    if (originalRefreshToken === undefined) delete process.env.GOOGLE_CALENDAR_REFRESH_TOKEN
    else process.env.GOOGLE_CALENDAR_REFRESH_TOKEN = originalRefreshToken
  }
})

test("uses OAuth refresh-token credentials when configured", () => {
  const originalEnabled = process.env.GOOGLE_CALENDAR_ENABLED
  const originalCalendarId = process.env.GOOGLE_CALENDAR_ID
  const originalToken = process.env.GOOGLE_CALENDAR_ACCESS_TOKEN
  const originalClientId = process.env.GOOGLE_CALENDAR_CLIENT_ID
  const originalClientSecret = process.env.GOOGLE_CALENDAR_CLIENT_SECRET
  const originalRefreshToken = process.env.GOOGLE_CALENDAR_REFRESH_TOKEN

  try {
    process.env.GOOGLE_CALENDAR_ENABLED = "true"
    process.env.GOOGLE_CALENDAR_ID = "merchant-success@example.com"
    delete process.env.GOOGLE_CALENDAR_ACCESS_TOKEN
    process.env.GOOGLE_CALENDAR_CLIENT_ID = "calendar-client-id"
    process.env.GOOGLE_CALENDAR_CLIENT_SECRET = "calendar-client-secret"
    process.env.GOOGLE_CALENDAR_REFRESH_TOKEN = "calendar-refresh-token"

    assert.deepEqual(getGoogleCalendarConfig(), {
      enabled: true,
      calendarId: "merchant-success@example.com",
      auth: {
        type: "refresh-token",
        clientId: "calendar-client-id",
        clientSecret: "calendar-client-secret",
        refreshToken: "calendar-refresh-token",
      },
    })
  } finally {
    if (originalEnabled === undefined) delete process.env.GOOGLE_CALENDAR_ENABLED
    else process.env.GOOGLE_CALENDAR_ENABLED = originalEnabled

    if (originalCalendarId === undefined) delete process.env.GOOGLE_CALENDAR_ID
    else process.env.GOOGLE_CALENDAR_ID = originalCalendarId

    if (originalToken === undefined) delete process.env.GOOGLE_CALENDAR_ACCESS_TOKEN
    else process.env.GOOGLE_CALENDAR_ACCESS_TOKEN = originalToken

    if (originalClientId === undefined) delete process.env.GOOGLE_CALENDAR_CLIENT_ID
    else process.env.GOOGLE_CALENDAR_CLIENT_ID = originalClientId

    if (originalClientSecret === undefined) delete process.env.GOOGLE_CALENDAR_CLIENT_SECRET
    else process.env.GOOGLE_CALENDAR_CLIENT_SECRET = originalClientSecret

    if (originalRefreshToken === undefined) delete process.env.GOOGLE_CALENDAR_REFRESH_TOKEN
    else process.env.GOOGLE_CALENDAR_REFRESH_TOKEN = originalRefreshToken
  }
})

test("exchanges OAuth refresh-token credentials for a Calendar access token", async () => {
  const originalFetch = globalThis.fetch
  const requests: Array<{ url: string; body: URLSearchParams }> = []

  try {
    globalThis.fetch = async (input, init) => {
      const body = new URLSearchParams(String(init?.body))
      requests.push({ url: String(input), body })
      return new Response(
        JSON.stringify({ access_token: "delegated-access-token", expires_in: 3600 }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    }

    const token = await getGoogleCalendarAccessToken({
      enabled: true,
      calendarId: "merchant-success@example.com",
      auth: {
        type: "refresh-token",
        clientId: "calendar-client-id",
        clientSecret: "calendar-client-secret",
        refreshToken: "calendar-refresh-token",
      },
    })

    assert.equal(token, "delegated-access-token")
    assert.equal(requests.length, 1)
    assert.equal(requests[0].url, "https://oauth2.googleapis.com/token")
    assert.equal(requests[0].body.get("grant_type"), "refresh_token")
    assert.equal(requests[0].body.get("client_id"), "calendar-client-id")
    assert.equal(requests[0].body.get("client_secret"), "calendar-client-secret")
    assert.equal(requests[0].body.get("refresh_token"), "calendar-refresh-token")
  } finally {
    globalThis.fetch = originalFetch
  }
})

test("records failed sync status without throwing when Google Calendar rejects the request", async () => {
  const originalEnabled = process.env.GOOGLE_CALENDAR_ENABLED
  const originalCalendarId = process.env.GOOGLE_CALENDAR_ID
  const originalToken = process.env.GOOGLE_CALENDAR_ACCESS_TOKEN
  const originalFetch = globalThis.fetch
  const queries: Array<{ sql: string; params: unknown[] }> = []

  try {
    process.env.GOOGLE_CALENDAR_ENABLED = "true"
    process.env.GOOGLE_CALENDAR_ID = "merchant-success@example.com"
    process.env.GOOGLE_CALENDAR_ACCESS_TOKEN = "access-token"
    globalThis.fetch = async () =>
      new Response(
        JSON.stringify({ error: { message: "Calendar write denied" } }),
        {
          status: 403,
          headers: { "Content-Type": "application/json" },
        }
      )

    const result = await syncOnboardingAppointmentToGoogleCalendar(
      {
        query: async (sql: string, params: unknown[]) => {
          queries.push({ sql, params })
          return [[], []]
        },
      } as never,
      {
        id: "42",
        outletName: "KLCC Outlet",
        installationType: "On-site",
        scheduledAt: "2026-05-14 01:30:00.000",
        paymentStatus: "Paid",
        status: "Approved",
        createdByName: "Aina",
        assignedMsUserName: "Mei",
        decisionReason: null,
        googleCalendarId: null,
        googleEventId: null,
      }
    )

    assert.deepEqual(result, {
      status: "failed",
      error: "Calendar write denied",
    })
    assert.equal(queries.length, 1)
    assert.match(queries[0].sql, /google_sync_status = 'failed'/)
    assert.deepEqual(queries[0].params, [
      "merchant-success@example.com",
      "Calendar write denied",
      "42",
    ])
  } finally {
    globalThis.fetch = originalFetch

    if (originalEnabled === undefined) delete process.env.GOOGLE_CALENDAR_ENABLED
    else process.env.GOOGLE_CALENDAR_ENABLED = originalEnabled

    if (originalCalendarId === undefined) delete process.env.GOOGLE_CALENDAR_ID
    else process.env.GOOGLE_CALENDAR_ID = originalCalendarId

    if (originalToken === undefined) delete process.env.GOOGLE_CALENDAR_ACCESS_TOKEN
    else process.env.GOOGLE_CALENDAR_ACCESS_TOKEN = originalToken
  }
})
