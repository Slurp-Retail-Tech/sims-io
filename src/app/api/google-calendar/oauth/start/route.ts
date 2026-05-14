import { NextRequest, NextResponse } from "next/server"

import { createOpaqueToken } from "@/lib/auth"
import { getGoogleCalendarOAuthClientConfig } from "@/lib/google-calendar"

const GOOGLE_CALENDAR_OAUTH_STATE_COOKIE = "sims-google-calendar-oauth-state"
const GOOGLE_CALENDAR_EVENTS_SCOPE =
  "https://www.googleapis.com/auth/calendar.events"

export async function GET(request: NextRequest) {
  const config = getGoogleCalendarOAuthClientConfig(request.nextUrl.origin)
  if (!config.enabled) {
    return NextResponse.json(
      { error: "Google Calendar OAuth client is not configured." },
      { status: 500 }
    )
  }

  const state = createOpaqueToken()
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth")
  url.searchParams.set("client_id", config.clientId)
  url.searchParams.set("redirect_uri", config.redirectUri)
  url.searchParams.set("response_type", "code")
  url.searchParams.set("scope", GOOGLE_CALENDAR_EVENTS_SCOPE)
  url.searchParams.set("state", state)
  url.searchParams.set("access_type", "offline")
  url.searchParams.set("prompt", "consent")

  const response = NextResponse.redirect(url)
  response.cookies.set(GOOGLE_CALENDAR_OAUTH_STATE_COOKIE, state, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 10 * 60,
    path: "/",
  })

  return response
}
