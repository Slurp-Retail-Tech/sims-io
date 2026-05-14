import { NextRequest, NextResponse } from "next/server"

import { getGoogleCalendarOAuthClientConfig } from "@/lib/google-calendar"

const GOOGLE_CALENDAR_OAUTH_STATE_COOKIE = "sims-google-calendar-oauth-state"

type GoogleCalendarOAuthTokenResponse = {
  refresh_token?: string
  error?: string
  error_description?: string
}

function renderTokenPage(input: {
  refreshToken?: string
  error?: string
}) {
  const content = input.refreshToken
    ? `
      <p>Copy this refresh token into your deployment secret:</p>
      <textarea readonly rows="8">${input.refreshToken}</textarea>
      <pre>GOOGLE_CALENDAR_REFRESH_TOKEN=${input.refreshToken}</pre>
    `
    : `
      <p class="error">${input.error ?? "Unable to generate refresh token."}</p>
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
          textarea { box-sizing: border-box; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; margin-top: 12px; padding: 12px; width: 100%; }
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
      },
    }
  )
}

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code")
  const state = request.nextUrl.searchParams.get("state")
  const storedState = request.cookies.get(GOOGLE_CALENDAR_OAUTH_STATE_COOKIE)?.value

  if (!code || !state || !storedState || state !== storedState) {
    const response = renderTokenPage({ error: "Invalid or expired OAuth state." })
    response.cookies.set(GOOGLE_CALENDAR_OAUTH_STATE_COOKIE, "", {
      maxAge: 0,
      path: "/",
    })
    return response
  }

  const config = getGoogleCalendarOAuthClientConfig(request.nextUrl.origin)
  if (!config.enabled) {
    const response = renderTokenPage({
      error: "Google Calendar OAuth client is not configured.",
    })
    response.cookies.set(GOOGLE_CALENDAR_OAUTH_STATE_COOKIE, "", {
      maxAge: 0,
      path: "/",
    })
    return response
  }

  const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
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

  const response = renderTokenPage({
    refreshToken: tokenPayload?.refresh_token,
    error: tokenResponse.ok
      ? "Google did not return a refresh token. Revoke the prior app grant and retry."
      : tokenPayload?.error_description ??
        tokenPayload?.error ??
        `Google token exchange failed (${tokenResponse.status}).`,
  })
  response.cookies.set(GOOGLE_CALENDAR_OAUTH_STATE_COOKIE, "", {
    maxAge: 0,
    path: "/",
  })
  return response
}
