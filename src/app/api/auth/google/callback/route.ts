import { NextRequest, NextResponse } from "next/server"

import { queryWithReconnect } from "@/lib/db"
import {
  createSession,
  getGoogleClientConfig,
  normalizeEmail,
  resolveAppBaseUrl,
  setAuthCookie,
  type UserStatus,
} from "@/lib/auth"

const GOOGLE_STATE_COOKIE = "sims-google-state"

type GoogleTokenResponse = {
  access_token?: string
  error?: string
}

type GoogleUserInfo = {
  sub?: string
  email?: string
  email_verified?: boolean
  hd?: string
}

type UserRow = {
  id: string
  name: string
  email: string
  avatar_url: string | null
  department: string
  role: string
  status: UserStatus
  password_hash: string | null
  page_access: unknown
  google_subject: string | null
  google_workspace_domain: string | null
}

function redirectToLogin(request: NextRequest, error: string) {
  const base = resolveAppBaseUrl(request.nextUrl.origin)
  return NextResponse.redirect(new URL(`/login?error=${error}`, base))
}

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code")
  const state = request.nextUrl.searchParams.get("state")
  const storedState = request.cookies.get(GOOGLE_STATE_COOKIE)?.value

  if (!code || !state || !storedState || state !== storedState) {
    const response = redirectToLogin(request, "sso_failed")
    response.cookies.set(GOOGLE_STATE_COOKIE, "", { maxAge: 0, path: "/" })
    return response
  }

  const { clientId, clientSecret, redirectUri, allowedDomains } =
    getGoogleClientConfig(request.nextUrl.origin)
  if (!clientId || !clientSecret || allowedDomains.length === 0) {
    const response = redirectToLogin(request, "sso_unavailable")
    response.cookies.set(GOOGLE_STATE_COOKIE, "", { maxAge: 0, path: "/" })
    return response
  }

  const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }),
    cache: "no-store",
  })

  if (!tokenResponse.ok) {
    return redirectToLogin(request, "sso_failed")
  }

  const tokenPayload = (await tokenResponse.json()) as GoogleTokenResponse
  if (!tokenPayload.access_token) {
    return redirectToLogin(request, "sso_failed")
  }

  const userInfoResponse = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
    headers: { Authorization: `Bearer ${tokenPayload.access_token}` },
    cache: "no-store",
  })

  if (!userInfoResponse.ok) {
    return redirectToLogin(request, "sso_failed")
  }

  const userInfo = (await userInfoResponse.json()) as GoogleUserInfo
  const email = normalizeEmail(userInfo.email)
  const hostedDomain = normalizeEmail(userInfo.hd)

  if (
    !userInfo.sub ||
    !email ||
    userInfo.email_verified !== true ||
    !hostedDomain ||
    !allowedDomains.includes(hostedDomain)
  ) {
    return redirectToLogin(request, "sso_not_allowed")
  }

  const [subjectRows] = await queryWithReconnect<UserRow[]>(
    `
      SELECT id, name, email, avatar_url, department, role, status, password_hash, page_access, google_subject, google_workspace_domain
      FROM users
      WHERE google_subject = ?
      LIMIT 1
    `,
    [userInfo.sub]
  )
  const linkedUser = subjectRows[0]
  if (linkedUser && normalizeEmail(linkedUser.email) !== email) {
    return redirectToLogin(request, "sso_failed")
  }

  const [emailRows] = await queryWithReconnect<UserRow[]>(
    `
      SELECT id, name, email, avatar_url, department, role, status, password_hash, page_access, google_subject, google_workspace_domain
      FROM users
      WHERE email = ?
      LIMIT 1
    `,
    [email]
  )

  const user = emailRows[0]
  if (!user) {
    return redirectToLogin(request, "sso_not_allowed")
  }
  if (user.status === "pending_activation") {
    return redirectToLogin(request, "activation_required")
  }
  if (user.status !== "active") {
    return redirectToLogin(request, "account_inactive")
  }

  if (user.google_subject && user.google_subject !== userInfo.sub) {
    return redirectToLogin(request, "sso_conflict")
  }
  if (linkedUser && linkedUser.id !== user.id) {
    return redirectToLogin(request, "sso_conflict")
  }

  await queryWithReconnect(
    `
      UPDATE users
      SET
        google_subject = COALESCE(google_subject, ?),
        google_workspace_domain = ?,
        google_linked_at = CASE
          WHEN google_subject IS NULL THEN CURRENT_TIMESTAMP(3)
          ELSE google_linked_at
        END,
        last_login_at = CURRENT_TIMESTAMP(3),
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `,
    [userInfo.sub, hostedDomain, user.id]
  )

  const rawToken = await createSession(user.id, true)

  const base = resolveAppBaseUrl(request.nextUrl.origin)
  const response = NextResponse.redirect(new URL("/overview", base))
  response.cookies.set(GOOGLE_STATE_COOKIE, "", { maxAge: 0, path: "/" })
  setAuthCookie(response, rawToken, true)
  return response
}
