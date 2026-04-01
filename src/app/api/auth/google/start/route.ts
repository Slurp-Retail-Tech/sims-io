import { NextRequest, NextResponse } from "next/server"

import { createOpaqueToken, getGoogleClientConfig } from "@/lib/auth"

const GOOGLE_STATE_COOKIE = "sims-google-state"

export async function GET(request: NextRequest) {
  const { clientId, redirectUri, allowedDomains } = getGoogleClientConfig(
    request.nextUrl.origin
  )

  if (!clientId || allowedDomains.length === 0) {
    return NextResponse.redirect(
      new URL("/login?error=sso_unavailable", request.url)
    )
  }

  const state = createOpaqueToken()
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth")
  url.searchParams.set("client_id", clientId)
  url.searchParams.set("redirect_uri", redirectUri)
  url.searchParams.set("response_type", "code")
  url.searchParams.set("scope", "openid email profile")
  url.searchParams.set("state", state)
  url.searchParams.set("prompt", "select_account")
  if (allowedDomains.length === 1) {
    url.searchParams.set("hd", allowedDomains[0])
  }

  const response = NextResponse.redirect(url)
  response.cookies.set(GOOGLE_STATE_COOKIE, state, {
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production" || process.env.APP_BASE_URL?.startsWith("https://"),
    maxAge: 10 * 60,
    path: "/",
  })

  return response
}
