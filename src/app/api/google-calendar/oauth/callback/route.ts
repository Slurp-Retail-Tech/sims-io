import { NextRequest, NextResponse } from "next/server"
import { httpFetch } from "@/lib/http"
import { escapeHtml } from "@/lib/html"

import { requireAuthenticatedUser } from "@/lib/auth"
import {
  getGoogleCalendarOAuthClientConfig,
  isCalendarOAuthFlowEnabled,
} from "@/lib/google-calendar"
import { SUPER_ADMIN_ROLE } from "@/lib/page-access"

const GOOGLE_CALENDAR_OAUTH_STATE_COOKIE = "sims-google-calendar-oauth-state"

type GoogleCalendarOAuthTokenResponse = {
  refresh_token?: string
  error?: string
  error_description?: string
}

function renderResultPage(input: { success: boolean; error?: string }) {
  // The refresh token is deliberately never rendered here — it is logged
  // server-side instead. `input.error` may echo Google's error_description,
  // so it is always escaped.
  const content = input.success
    ? `
      <p>Refresh token generated — check the server logs for
      <code>GOOGLE_CALENDAR_REFRESH_TOKEN</code> and copy it into your
      deployment secret.</p>
    `
    : `
      <p class="error">${escapeHtml(input.error ?? "Unable to generate refresh token.")}</p>
      <p>Try again from <code>/api/google-calendar/oauth/start</code>. If Google does not return a refresh token, revoke the app grant for this account and retry.</p>
    `

  return new NextResponse(
    `<!doctype html>
    <html>
      <head>
        <meta charset="utf-8" />
        <title>SIMS Google Calendar OAuth</title>
        <style>
          body { color: #111827; font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; margin: 40px; max-width: 840px; }
          pre { background: #f3f4f6; border-radius: 8px; overflow-wrap: anywhere; padding: 12px; white-space: pre-wrap; }
          .error { color: #b91c1c; font-weight: 600; }
        </style>
      </head>
      <body>
        <h1>Google Calendar Refresh Token</h1>
        ${content}
      </body>
    </html>`,
    {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
        "Referrer-Policy": "no-referrer",
        "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'",
      },
    }
  )
}

function clearStateCookie(response: NextResponse) {
  response.cookies.set(GOOGLE_CALENDAR_OAUTH_STATE_COOKIE, "", {
    maxAge: 0,
    path: "/",
  })
  return response
}

export async function GET(request: NextRequest) {
  if (!isCalendarOAuthFlowEnabled()) {
    return NextResponse.json({ error: "Not found." }, { status: 404 })
  }

  const user = await requireAuthenticatedUser(request)
  if (!user) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 })
  }
  if (user.role !== SUPER_ADMIN_ROLE) {
    return NextResponse.json({ error: "Forbidden." }, { status: 403 })
  }

  const code = request.nextUrl.searchParams.get("code")
  const state = request.nextUrl.searchParams.get("state")
  const storedState = request.cookies.get(GOOGLE_CALENDAR_OAUTH_STATE_COOKIE)?.value

  if (!code || !state || !storedState || state !== storedState) {
    return clearStateCookie(
      renderResultPage({ success: false, error: "Invalid or expired OAuth state." })
    )
  }

  const config = getGoogleCalendarOAuthClientConfig(request.nextUrl.origin)
  if (!config.enabled) {
    return clearStateCookie(
      renderResultPage({
        success: false,
        error: "Google Calendar OAuth client is not configured.",
      })
    )
  }

  // Never retried: an authorization code is single-use.
  const tokenResponse = await httpFetch("https://oauth2.googleapis.com/token", {
    label: "googleCalendarOauth.exchangeCode",
    timeoutMs: 10_000,
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: config.clientId,
      client_secret: config.clientSecret,
      redirect_uri: config.redirectUri,
      grant_type: "authorization_code",
    }),
    cache: "no-store",
  })

  const tokenPayload =
    (await tokenResponse.json().catch(() => null)) as
      | GoogleCalendarOAuthTokenResponse
      | null

  if (tokenPayload?.refresh_token) {
    console.info(
      "[google-calendar/oauth] Refresh token generated. " +
        `GOOGLE_CALENDAR_REFRESH_TOKEN=${tokenPayload.refresh_token}`
    )
    return clearStateCookie(renderResultPage({ success: true }))
  }

  return clearStateCookie(
    renderResultPage({
      success: false,
      error: tokenResponse.ok
        ? "Google did not return a refresh token. Revoke the prior app grant and retry."
        : tokenPayload?.error_description ??
          tokenPayload?.error ??
          `Google token exchange failed (${tokenResponse.status}).`,
    })
  )
}
