import { createHash, randomBytes, scryptSync, timingSafeEqual } from "crypto"

import type { NextRequest, NextResponse } from "next/server"

import { queryWithReconnect } from "@/lib/db"
import { resolveStoredObjectUrl } from "@/lib/storage"

export const SESSION_COOKIE_NAME = "sims-auth"
const DAY_SECONDS = 24 * 60 * 60
const DEFAULT_SESSION_TTL_SECONDS = 7 * DAY_SECONDS
const REMEMBER_SESSION_TTL_SECONDS = 30 * DAY_SECONDS

export const AUTH_TOKEN_TYPES = ["activation", "password_reset"] as const
export type AuthTokenType = (typeof AUTH_TOKEN_TYPES)[number]

export const USER_STATUSES = [
  "pending_activation",
  "active",
  "inactive",
] as const
export type UserStatus = (typeof USER_STATUSES)[number]

export type SessionUser = {
  id: string
  name: string
  email: string
  department: string
  role: string
  avatarUrl?: string | null
  pageAccess: string[]
}

export type AuthenticatedUser = SessionUser & {
  status: UserStatus
  passwordHash: string | null
  googleSubject: string | null
  googleWorkspaceDomain: string | null
}

type SessionUserRow = {
  id: string
  name: string
  email: string
  avatar_url: string | null
  department: string
  role: string
  page_access: unknown
}

type UserRow = SessionUserRow & {
  status: UserStatus
  password_hash: string | null
  google_subject: string | null
  google_workspace_domain: string | null
}

export function normalizeEmail(value: string | null | undefined) {
  return value?.trim().toLowerCase() ?? ""
}

export function parsePageAccess(value: unknown) {
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === "string")
  }

  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value)
      return Array.isArray(parsed)
        ? parsed.filter((item): item is string => typeof item === "string")
        : []
    } catch {
      return []
    }
  }

  return []
}

export function hashPassword(password: string) {
  const salt = randomBytes(16).toString("hex")
  const hash = scryptSync(password, salt, 64).toString("hex")
  return `${salt}:${hash}`
}

export function verifyPassword(password: string, stored: string | null) {
  if (!stored) {
    return false
  }

  const [salt, hash] = stored.split(":")
  if (!salt || !hash) {
    return false
  }

  const derived = scryptSync(password, salt, 64)
  const storedBuffer = Buffer.from(hash, "hex")
  if (storedBuffer.length !== derived.length) {
    return false
  }

  return timingSafeEqual(storedBuffer, derived)
}

export function buildSessionUser(row: SessionUserRow): SessionUser {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    avatarUrl: resolveStoredObjectUrl(row.avatar_url),
    department: row.department,
    role: row.role,
    pageAccess: parsePageAccess(row.page_access),
  }
}

function buildAuthenticatedUser(row: UserRow): AuthenticatedUser {
  return {
    ...buildSessionUser(row),
    status: row.status,
    passwordHash: row.password_hash,
    googleSubject: row.google_subject,
    googleWorkspaceDomain: row.google_workspace_domain,
  }
}

export function getSessionMaxAge(remember: boolean) {
  return remember ? REMEMBER_SESSION_TTL_SECONDS : DEFAULT_SESSION_TTL_SECONDS
}

// ---------------------------------------------------------------------------
// Opaque token helpers
// ---------------------------------------------------------------------------

export function createOpaqueToken(): string {
  return randomBytes(32).toString("hex")
}

export function hashOpaqueToken(token: string): string {
  return createHash("sha256").update(token).digest("hex")
}

// ---------------------------------------------------------------------------
// Server-side session management (SIMS-02)
// ---------------------------------------------------------------------------

/**
 * Create a new server-side session for `userId`.
 *
 * Generates a cryptographically random 32-byte opaque token, stores only its
 * SHA-256 hash in the `sessions` table, and returns the raw token for
 * placement in the `sims-auth` cookie.
 */
export async function createSession(
  userId: string,
  remember: boolean
): Promise<string> {
  const rawToken = createOpaqueToken()
  const tokenHash = hashOpaqueToken(rawToken)
  const ttlSeconds = getSessionMaxAge(remember)

  await queryWithReconnect(
    `
      INSERT INTO sessions (user_id, token_hash, remember, expires_at)
      VALUES (?, ?, ?, DATE_ADD(NOW(3), INTERVAL ? SECOND))
    `,
    [userId, tokenHash, remember, ttlSeconds]
  )

  return rawToken
}

/**
 * Delete the session row that matches `rawToken`.
 * Safe to call with a token that no longer exists.
 */
export async function deleteSession(rawToken: string): Promise<void> {
  const tokenHash = hashOpaqueToken(rawToken)
  await queryWithReconnect("DELETE FROM sessions WHERE token_hash = ?", [
    tokenHash,
  ])
}

// ---------------------------------------------------------------------------
// Cookie helpers
// ---------------------------------------------------------------------------

function isSecureContext(): boolean {
  return (
    process.env.NODE_ENV === "production" ||
    process.env.APP_BASE_URL?.trim().startsWith("https://") === true
  )
}

/**
 * Write the raw session token into the `sims-auth` httpOnly cookie.
 * SameSite is "lax" so the cookie is forwarded after OAuth redirects
 * (Google sends a cross-site top-level navigation back to the callback,
 * and "strict" cookies are not attached to the redirect that follows).
 * Lax still blocks cross-site POST requests, so CSRF protection is intact.
 */
export function setAuthCookie(
  response: NextResponse,
  rawToken: string,
  remember: boolean
): void {
  response.cookies.set(SESSION_COOKIE_NAME, rawToken, {
    httpOnly: true,
    sameSite: "lax",
    secure: isSecureContext(),
    maxAge: getSessionMaxAge(remember),
    path: "/",
  })
}

/**
 * Clear the `sims-auth` cookie and, when the raw token is provided, delete
 * the corresponding session row from the database.
 */
export async function clearAuthCookie(
  response: NextResponse,
  rawToken?: string
): Promise<void> {
  if (rawToken) {
    await deleteSession(rawToken)
  }

  response.cookies.set(SESSION_COOKIE_NAME, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: isSecureContext(),
    maxAge: 0,
    path: "/",
  })
}

// ---------------------------------------------------------------------------
// Request authentication
// ---------------------------------------------------------------------------

/**
 * Look up the authenticated user from the request cookie.
 *
 * Hashes the raw cookie value, JOINs `sessions` + `users`, and checks
 * `expires_at` server-side. Returns `null` when the session is missing,
 * expired, or the user is not found.
 */
export async function getAuthenticatedUser(
  request: NextRequest
): Promise<AuthenticatedUser | null> {
  const rawToken = request.cookies.get(SESSION_COOKIE_NAME)?.value?.trim()
  if (!rawToken) {
    return null
  }

  const tokenHash = hashOpaqueToken(rawToken)

  const [rows] = await queryWithReconnect<UserRow[]>(
    `
      SELECT
        u.id,
        u.name,
        u.email,
        u.avatar_url,
        u.department,
        u.role,
        u.status,
        u.password_hash,
        u.page_access,
        u.google_subject,
        u.google_workspace_domain
      FROM sessions s
      INNER JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = ?
        AND s.expires_at > NOW(3)
      LIMIT 1
    `,
    [tokenHash]
  )

  const user = rows[0]
  return user ? buildAuthenticatedUser(user) : null
}

/**
 * Like `getAuthenticatedUser` but additionally requires `status = 'active'`.
 * All protected API routes call this function; the signature is unchanged.
 */
export async function requireAuthenticatedUser(
  request: NextRequest
): Promise<AuthenticatedUser | null> {
  const user = await getAuthenticatedUser(request)
  if (!user || user.status !== "active") {
    return null
  }
  return user
}

// ---------------------------------------------------------------------------
// URL / config helpers
// ---------------------------------------------------------------------------

/**
 * Resolve the application base URL.
 *
 * Only `APP_BASE_URL` (server-only) is consulted; `NEXT_PUBLIC_APP_URL` has
 * been removed to eliminate the risk of a client-controlled redirect target
 * influencing server-side redirect decisions (SIMS-14).
 */
export function resolveAppBaseUrl(origin?: string): string {
  const configured = process.env.APP_BASE_URL?.trim() || ""
  return configured || origin || "http://localhost:3000"
}

export function getGoogleWorkspaceDomains(): string[] {
  return (process.env.GOOGLE_WORKSPACE_DOMAINS ?? "")
    .split(",")
    .map((value) => normalizeEmail(value))
    .filter(Boolean)
}

export function getGoogleRedirectUri(origin?: string): string {
  const configured = process.env.GOOGLE_REDIRECT_URI?.trim()
  if (configured) {
    return configured
  }
  return `${resolveAppBaseUrl(origin)}/api/auth/google/callback`
}

export function getGoogleClientConfig(origin?: string): {
  clientId: string
  clientSecret: string
  redirectUri: string
  allowedDomains: string[]
} {
  const clientId = process.env.GOOGLE_CLIENT_ID?.trim() ?? ""
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim() ?? ""
  const redirectUri = getGoogleRedirectUri(origin)
  return {
    clientId,
    clientSecret,
    redirectUri,
    allowedDomains: getGoogleWorkspaceDomains(),
  }
}
