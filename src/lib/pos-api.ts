import { httpFetch } from "./http.ts"

type PosApiRecord = Record<string, unknown>
export type PosApiAuthSession = {
  token: string
  cookieHeader: string | null
}

const DEFAULT_AUTH_URL = "https://api.getslurp.com/api/login"
const DEFAULT_IMPORT_URL = "https://api.getslurp.com/api/franchise-retrieve/"
const DEFAULT_BRANCH_PATH = "/api/branch"

/**
 * POS data calls sit inside the merchant import and the PLUS update, which walk
 * many pages/rows serially — a per-call ceiling keeps one wedged page from
 * stalling a whole job. Overridable via POS_API_TIMEOUT_MS.
 */
const POS_API_TIMEOUT_MS = (() => {
  const raw = Number(process.env.POS_API_TIMEOUT_MS ?? 30_000)
  return Number.isFinite(raw) && raw > 0 ? raw : 30_000
})()

/** Login is a single short call; it does not need the data-call budget. */
const POS_AUTH_TIMEOUT_MS = 10_000

function mergeHeaders(...headersList: Array<HeadersInit | undefined>) {
  const merged = new Headers()
  for (const entry of headersList) {
    if (!entry) {
      continue
    }
    const headers = new Headers(entry)
    headers.forEach((value, key) => {
      merged.set(key, value)
    })
  }
  return merged
}

export function resolvePosAuthUrl() {
  return process.env.POS_AUTH_URL || DEFAULT_AUTH_URL
}

export function resolvePosImportUrl() {
  return process.env.POS_IMPORT_URL || DEFAULT_IMPORT_URL
}

export function resolvePosBranchUrl() {
  const configuredUrl = process.env.POS_BRANCH_URL?.trim()
  if (configuredUrl) {
    return configuredUrl
  }

  const authUrl = new URL(resolvePosAuthUrl())
  return new URL(DEFAULT_BRANCH_PATH, authUrl.origin).toString()
}

export function resolvePosApiBaseUrl() {
  const configuredUrl = process.env.POS_API_BASE_URL?.trim()
  if (configuredUrl) {
    return configuredUrl
  }
  const branchUrl = process.env.POS_BRANCH_URL?.trim()
  if (branchUrl) {
    return new URL(branchUrl).origin
  }
  const authUrl = new URL(resolvePosAuthUrl())
  return authUrl.origin
}

export function resolvePosApiUrl(path: string) {
  return new URL(path, resolvePosApiBaseUrl()).toString()
}

export function resolvePosMerchantIdApiUrl(path: string) {
  const configuredUrl = process.env.POS_MERCHANT_ID_BASE_URL?.trim()
  if (configuredUrl) {
    return new URL(path, configuredUrl).toString()
  }
  return resolvePosApiUrl(path)
}

export function resolvePosCategoryBusinessApiUrl(path: string) {
  const configuredUrl = process.env.POS_CATEGORY_BUSINESS_BASE_URL?.trim()
  if (configuredUrl) {
    return new URL(path, configuredUrl).toString()
  }
  return resolvePosApiUrl(path)
}

export function resolvePosCredentials() {
  const email = process.env.POS_API_EMAIL
  const password = process.env.POS_API_PASSWORD
  if (!email || !password) {
    throw new Error("POS_API_EMAIL and POS_API_PASSWORD are required")
  }
  return { email, password }
}

export function isPosApiRecord(value: unknown): value is PosApiRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

// Redacts a token down to a short, non-reversible preview suitable for logs.
export function maskToken(token: string): string {
  if (token.length <= 8) {
    return "***"
  }
  return `${token.slice(0, 4)}…${token.slice(-2)} (${token.length} chars)`
}

const tokenKeys = [
  "token",
  "access_token",
  "accessToken",
  "jwt",
  "jwt_token",
  "id_token",
  "auth_token",
  "api_token",
] as const

function readTokenFromRecord(record: PosApiRecord) {
  for (const key of tokenKeys) {
    const value = record[key]
    if (typeof value === "string") {
      return value
    }
    if (isPosApiRecord(value)) {
      for (const nestedKey of ["token", "access", "access_token", "value"]) {
        const nestedValue = value[nestedKey]
        if (typeof nestedValue === "string") {
          return nestedValue
        }
      }
    }
  }
  return null
}

export function extractPosToken(payload: unknown, headers?: Headers) {
  if (isPosApiRecord(payload)) {
    const directToken = readTokenFromRecord(payload)
    if (directToken) {
      return directToken
    }

    const data = payload.data
    if (isPosApiRecord(data)) {
      const dataToken = readTokenFromRecord(data)
      if (dataToken) {
        return dataToken
      }
    }

    const result = payload.result ?? payload.results
    if (isPosApiRecord(result)) {
      const resultToken = readTokenFromRecord(result)
      if (resultToken) {
        return resultToken
      }
    }
  }

  if (!headers) {
    return null
  }

  for (const key of [
    "authorization",
    "Authorization",
    "x-access-token",
    "x-auth-token",
    "x-token",
  ]) {
    const value = headers.get(key)
    if (value) {
      return value.startsWith("Bearer ") ? value.slice(7) : value
    }
  }

  return null
}

export function getPosApiItems(payload: unknown) {
  if (!payload) {
    return []
  }
  if (Array.isArray(payload)) {
    return payload
  }
  if (!isPosApiRecord(payload)) {
    return []
  }

  const candidates = [
    payload.data,
    payload.results,
    payload.items,
    isPosApiRecord(payload.data) ? payload.data.items : undefined,
  ]

  for (const candidate of candidates) {
    if (Array.isArray(candidate)) {
      return candidate
    }
  }

  return []
}

export async function authenticatePosApi() {
  const session = await authenticatePosApiSession()
  return session.token
}

export async function authenticatePosApiSession(): Promise<PosApiAuthSession> {
  const { email, password } = resolvePosCredentials()
  // Never retried: a failed login is a credential or configuration problem, and
  // repeating it only risks tripping upstream lockout.
  const authResponse = await httpFetch(resolvePosAuthUrl(), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
    label: "pos.authenticate",
    timeoutMs: POS_AUTH_TIMEOUT_MS,
  })

  if (!authResponse.ok) {
    throw new Error(`Auth failed with status ${authResponse.status}`)
  }

  const authPayload = await authResponse.json()
  const token = extractPosToken(authPayload, authResponse.headers)
  if (!token) {
    const payloadKeys = isPosApiRecord(authPayload)
      ? Object.keys(authPayload).join(", ")
      : "unknown"
    throw new Error(
      `Auth response did not include a token (keys: ${payloadKeys}).`
    )
  }

  const cookieHeader =
    typeof authResponse.headers.getSetCookie === "function"
      ? authResponse.headers
          .getSetCookie()
          .map((cookie) => cookie.split(";")[0])
          .filter(Boolean)
          .join("; ") || null
      : authResponse.headers.get("set-cookie")?.split(",").map((cookie) => cookie.split(";")[0].trim()).filter(Boolean).join("; ") || null

  return {
    token,
    cookieHeader,
  }
}

/**
 * The POS API's 401 fallback, in one place.
 *
 * Some POS endpoints reject the `Authorization: Bearer` header and only accept
 * the token as a query parameter with an `Authorization: Token` header. Rather
 * than knowing which is which, every data call tries the header form first and
 * falls back once on a 401.
 *
 * The fallback URL carries the token in its query string, so it must never be
 * logged — see `redactUrlForLogs` in src/lib/http.ts. That is an upstream
 * requirement, not a choice made here.
 */
async function fetchPosApiWithTokenFallback(
  input: URL | string,
  token: string,
  headers: HeadersInit,
  init: RequestInit,
  label: string
) {
  const url = typeof input === "string" ? new URL(input) : input

  const response = await httpFetch(url.toString(), {
    ...init,
    headers,
    label,
    timeoutMs: POS_API_TIMEOUT_MS,
  })
  if (response.status !== 401) {
    return response
  }

  const retryUrl = new URL(url.toString())
  retryUrl.searchParams.set("api_token", token)
  retryUrl.searchParams.set("token", token)

  return httpFetch(retryUrl.toString(), {
    ...init,
    headers: mergeHeaders(headers, {
      Authorization: `Token ${token}`,
    }),
    label: `${label}.tokenFallback`,
    timeoutMs: POS_API_TIMEOUT_MS,
  })
}

export async function fetchPosApiWithToken(url: URL, token: string) {
  return fetchPosApiWithTokenFallback(
    url,
    token,
    buildPosApiHeaders(token),
    {},
    "pos.fetchWithToken"
  )
}

export function buildPosApiHeaders(token: string, headers?: HeadersInit) {
  return mergeHeaders(headers, {
    Authorization: `Bearer ${token}`,
    "X-Api-Token": token,
    "X-Api-Key": token,
  })
}

export function buildPosApiSessionHeaders(
  session: PosApiAuthSession,
  headers?: HeadersInit
) {
  return mergeHeaders(
    headers,
    buildPosApiHeaders(session.token),
    session.cookieHeader ? { Cookie: session.cookieHeader } : undefined
  )
}

export async function fetchPosApiWithTokenInit(
  input: URL | string,
  token: string,
  init: RequestInit = {}
) {
  return fetchPosApiWithTokenFallback(
    input,
    token,
    buildPosApiHeaders(token, init.headers),
    init,
    "pos.fetchWithTokenInit"
  )
}

export async function fetchPosApiWithSessionInit(
  input: URL | string,
  session: PosApiAuthSession,
  init: RequestInit = {}
) {
  return fetchPosApiWithTokenFallback(
    input,
    session.token,
    buildPosApiSessionHeaders(session, init.headers),
    init,
    "pos.fetchWithSessionInit"
  )
}
