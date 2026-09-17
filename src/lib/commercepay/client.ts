/**
 * The CommercePay client: authenticate, open a hosted payment session, query
 * a payment.
 *
 * Never throws for a gateway or network failure. Every call returns a
 * `CommercePayOutcome`, so a caller decides what a failure means for its own
 * row rather than catching at a distance. A configuration failure (no tenant
 * id) is the one exception, because that is a deployment fault, not a
 * runtime one, and the env manifest already refuses to boot half-configured.
 *
 * The access token is cached for its lifetime less five minutes, keyed by
 * tenant, so a burst of merchants paying at once costs one authentication.
 * A signed call that comes back 401 drops the cache and retries exactly once
 * with a fresh token.
 *
 * Both the fetch and the cache are injected so the client is unit-tested
 * against a scripted gateway with no network and no Redis.
 */

import { httpFetch } from "../http.ts"
import { createLogger } from "../logger.ts"
import { readCommercePayResponse } from "./response.ts"
import type { CommercePayOutcome } from "./response.ts"
import { signRequest } from "./signature.ts"
import type { SignableBody } from "./signature.ts"

const log = createLogger("commercepay")

export type CommercePayConfig = {
  baseUrl: string
  tenantId: string
  username: string
  password: string
  secretKey: string
}

export function readCommercePayConfig(
  env: Record<string, string | undefined> = process.env
): CommercePayConfig | null {
  const tenantId = env.COMMERCEPAY_TENANT_ID?.trim()
  if (!tenantId) {
    return null
  }
  const username = env.COMMERCEPAY_USERNAME?.trim()
  const password = env.COMMERCEPAY_PASSWORD?.trim()
  const secretKey = env.COMMERCEPAY_SECRET_KEY?.trim()
  if (!username || !password || !secretKey) {
    // The manifest refuses to boot like this in production; in development
    // treat it as "not configured" rather than half-working.
    return null
  }
  return {
    baseUrl: (env.COMMERCEPAY_BASE_URL?.trim() || "https://staging-payments.commerce.asia").replace(/\/+$/, ""),
    tenantId,
    username,
    password,
    secretKey,
  }
}

export type TokenCache = {
  get(key: string): Promise<string | null>
  set(key: string, value: string, ttlSeconds: number): Promise<void>
  delete(key: string): Promise<void>
}

/** Fields CommercePay accepts on InitialSession that SIMS sends. */
export type InitialSessionInput = {
  currencyCode: string
  /** Integer units: 1000 = 10.00. */
  amount: number
  referenceCode: string
  description: string | null
  ipAddress: string
  userAgent: string | null
  returnUrl: string
  callbackUrl: string
  customer: { email: string | null; name: string | null } | null
  expiredInMinutes: number
}

export type InitialSessionResult = {
  redirectionType: number
  redirectUrl: string | null
  sessionNumber: string | null
}

export type QueryPaymentResult = {
  transactionNumber: string | null
  paymentSessionNumber: string | null
  referenceCode: string | null
  status: number
  currencyCode: string | null
  amount: number
  channelId: number | null
  providerTransactionNumber: string | null
  creationTime: string | null
  remark: string | null
  providerPaymentMethod: string | null
  providerErrorMessage: string | null
}

type ClientDeps = {
  fetchImpl?: typeof fetch
  cache?: TokenCache
  now?: () => number
}

const AUTH_PATH = "/api/TokenAuth/Authenticate"
const INITIAL_SESSION_PATH = "/api/services/app/PaymentGateway/InitialSession"
const QUERY_PATH = "/api/services/app/PaymentGateway/Query"

/** Refresh this far ahead of the token's own expiry. */
const TOKEN_REFRESH_MARGIN_SECONDS = 300
const TIMEOUT_MS = 15_000

function failure(message: string, code: number | null = null): CommercePayOutcome<never> {
  return { ok: false, code, message, isSignatureFailure: false }
}

export class CommercePayClient {
  private readonly config: CommercePayConfig
  private readonly fetchImpl: typeof fetch
  private readonly cache: TokenCache
  private readonly now: () => number

  constructor(config: CommercePayConfig, deps: ClientDeps = {}) {
    this.config = config
    this.fetchImpl = deps.fetchImpl ?? fetch
    this.cache = deps.cache ?? memoryTokenCache()
    this.now = deps.now ?? (() => Date.now())
  }

  private get tokenCacheKey(): string {
    return `commercepay:token:${this.config.tenantId}`
  }

  /** Obtain an access token, from cache where possible. */
  async getAccessToken(): Promise<CommercePayOutcome<string>> {
    const cached = await this.cache.get(this.tokenCacheKey)
    if (cached) {
      return { ok: true, result: cached }
    }

    let response: Response
    try {
      response = await httpFetch(
        `${this.config.baseUrl}${AUTH_PATH}`,
        {
          label: "commercepay.authenticate",
          method: "POST",
          timeoutMs: TIMEOUT_MS,
          headers: {
            "Content-Type": "application/json",
            "Abp-TenantId": this.config.tenantId,
          },
          body: JSON.stringify({
            userNameOrEmailAddress: this.config.username,
            password: this.config.password,
          }),
        },
        this.fetchImpl
      )
    } catch (error) {
      log.error("CommercePay authenticate failed to connect", error)
      return failure("Could not reach the payment gateway.")
    }

    const body = await readJson(response)
    if (response.status === 401) {
      return failure("The payment gateway rejected the merchant credentials.", null)
    }
    const outcome = unwrap<{ accessToken?: unknown; expireInSeconds?: unknown }>(body)
    if (!outcome.ok) {
      return outcome
    }
    const token = outcome.result?.accessToken
    if (typeof token !== "string" || !token) {
      return failure("The payment gateway returned no access token.")
    }
    const expires = Number(outcome.result?.expireInSeconds ?? 86_400)
    const ttl = Math.max(60, (Number.isFinite(expires) ? expires : 86_400) - TOKEN_REFRESH_MARGIN_SECONDS)
    await this.cache.set(this.tokenCacheKey, token, ttl)
    return { ok: true, result: token }
  }

  /** Open a hosted payment session. */
  async initialSession(
    input: InitialSessionInput
  ): Promise<CommercePayOutcome<InitialSessionResult>> {
    const body: SignableBody = {
      currencyCode: input.currencyCode,
      amount: input.amount,
      referenceCode: input.referenceCode,
      description: input.description,
      ipAddress: input.ipAddress,
      userAgent: input.userAgent,
      returnUrl: input.returnUrl,
      callbackUrl: input.callbackUrl,
      Customer: input.customer
        ? { email: input.customer.email, name: input.customer.name }
        : null,
      expiredInMinutes: input.expiredInMinutes,
      timestamp: this.now(),
    }
    return this.signedCall<InitialSessionResult>("POST", INITIAL_SESSION_PATH, body, null)
  }

  /** Query one payment by session number or transaction number. */
  async queryPayment(
    params: { sessionNumber?: string | null; transactionNumber?: string | null }
  ): Promise<CommercePayOutcome<QueryPaymentResult>> {
    if (!params.sessionNumber && !params.transactionNumber) {
      return failure("A session number or a transaction number is required.")
    }
    // The signature is computed over the camelCase object; the query string
    // uses the documented PascalCase names. Lower-casing makes them the same
    // by the time they are hashed.
    const data: SignableBody = {
      sessionNumber: params.sessionNumber ?? null,
      transactionNumber: params.transactionNumber ?? null,
      timestamp: this.now(),
    }
    const query = new URLSearchParams()
    if (params.sessionNumber) query.set("SessionNumber", params.sessionNumber)
    if (params.transactionNumber) query.set("TransactionNumber", params.transactionNumber)
    query.set("Timestamp", String(data.timestamp))
    return this.signedCall<QueryPaymentResult>("GET", QUERY_PATH, data, query.toString())
  }

  /**
   * A signed request, re-authenticating once on 401.
   *
   * Never retried otherwise: InitialSession is a POST that creates a session,
   * and a duplicate reference code is a hard error at the gateway.
   */
  private async signedCall<T>(
    method: "GET" | "POST",
    path: string,
    data: SignableBody,
    queryString: string | null,
    attempt = 0
  ): Promise<CommercePayOutcome<T>> {
    const token = await this.getAccessToken()
    if (!token.ok) {
      return token
    }

    const endpoint = `${this.config.baseUrl}${path}`
    const signature = signRequest(endpoint, data, this.config.secretKey)
    const url = queryString ? `${endpoint}?${queryString}` : endpoint

    let response: Response
    try {
      response = await httpFetch(
        url,
        {
          label: `commercepay.${path.split("/").pop()}`,
          method,
          timeoutMs: TIMEOUT_MS,
          headers: {
            "Content-Type": "application/json",
            "Abp-TenantId": this.config.tenantId,
            Authorization: `Bearer ${token.result}`,
            "cap-signature": signature,
          },
          body: method === "POST" ? JSON.stringify(data) : undefined,
        },
        this.fetchImpl
      )
    } catch (error) {
      log.error("CommercePay call failed to connect", error, { path })
      return failure("Could not reach the payment gateway.")
    }

    if (response.status === 401 && attempt === 0) {
      await this.cache.delete(this.tokenCacheKey)
      return this.signedCall<T>(method, path, data, queryString, 1)
    }

    const body = await readJson(response)
    const outcome = unwrap<T>(body)
    if (!outcome.ok) {
      log.warn("CommercePay call rejected", {
        path,
        status: response.status,
        code: outcome.code,
        message: outcome.message,
      })
    }
    return outcome
  }
}

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text()
  if (!text) {
    return null
  }
  try {
    return JSON.parse(text) as unknown
  } catch {
    return { error: { code: null, message: `Non-JSON response (${response.status}).` } }
  }
}

/**
 * Classify the envelope, then recover the bare-body shape.
 *
 * `readCommercePayResponse` looks for `result` / `error` / `success`. The
 * documented 200 responses are the bare object with none of those keys, which
 * that classifier reports as "ok with a null result". When the body is a
 * plain object carrying neither envelope key, the body itself is the result.
 */
function unwrap<T>(body: unknown): CommercePayOutcome<T> {
  const outcome = readCommercePayResponse<T>(body)
  if (
    outcome.ok &&
    outcome.result === null &&
    body &&
    typeof body === "object" &&
    !("result" in body) &&
    !("error" in body) &&
    !("success" in body)
  ) {
    return { ok: true, result: body as T }
  }
  return outcome
}

let sharedClient: CommercePayClient | null | undefined

/**
 * The process-wide client built from the environment, with the shared Redis
 * cache for the token. Null when the gateway is not configured, which the
 * public routes turn into "online payment is not available".
 */
export async function getCommercePayClient(): Promise<CommercePayClient | null> {
  if (sharedClient !== undefined) {
    return sharedClient
  }
  const config = readCommercePayConfig()
  if (!config) {
    sharedClient = null
    return null
  }
  const redis = await import("../redis.ts")
  sharedClient = new CommercePayClient(config, {
    cache: {
      get: redis.cacheGet,
      set: redis.cacheSet,
      delete: redis.cacheDelete,
    },
  })
  return sharedClient
}

function memoryTokenCache(): TokenCache {
  const store = new Map<string, { value: string; expiresAt: number }>()
  return {
    async get(key) {
      const entry = store.get(key)
      if (!entry || entry.expiresAt <= Date.now()) {
        store.delete(key)
        return null
      }
      return entry.value
    },
    async set(key, value, ttlSeconds) {
      store.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000 })
    },
    async delete(key) {
      store.delete(key)
    },
  }
}
