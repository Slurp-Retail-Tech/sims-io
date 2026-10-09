import assert from "node:assert/strict"
import test from "node:test"

import { CommercePayClient, readCommercePayConfig } from "./client.ts"
import type { CommercePayConfig, TokenCache } from "./client.ts"
import { signRequest } from "./signature.ts"

const config: CommercePayConfig = {
  baseUrl: "https://staging-payments.example.test",
  tenantId: "42",
  username: "merchant",
  password: "secret-password",
  secretKey: "KPksB8uuh9ZW2VFg",
}

type Call = { url: string; init: RequestInit }

/** A scripted gateway: each call pops the next response. */
function gateway(responses: Array<{ status: number; body: unknown }>) {
  const calls: Call[] = []
  const fetchImpl: typeof fetch = async (input, init) => {
    calls.push({ url: String(input), init: init ?? {} })
    const next = responses.shift()
    if (!next) {
      throw new Error("no scripted response left")
    }
    return new Response(JSON.stringify(next.body), {
      status: next.status,
      headers: { "content-type": "application/json" },
    })
  }
  return { calls, fetchImpl }
}

function cache(): TokenCache & { store: Map<string, string> } {
  const store = new Map<string, string>()
  return {
    store,
    async get(key) {
      return store.get(key) ?? null
    },
    async set(key, value) {
      store.set(key, value)
    },
    async delete(key) {
      store.delete(key)
    },
  }
}

const AUTH_OK = { status: 200, body: { accessToken: "tok-1", expireInSeconds: 86400 } }

test("config is absent without a tenant id, and half-configured is absent too", () => {
  assert.equal(readCommercePayConfig({}), null)
  assert.equal(
    readCommercePayConfig({ COMMERCEPAY_TENANT_ID: "1", COMMERCEPAY_USERNAME: "u" }),
    null
  )
  const full = readCommercePayConfig({
    COMMERCEPAY_TENANT_ID: "1",
    COMMERCEPAY_USERNAME: "u",
    COMMERCEPAY_PASSWORD: "p",
    COMMERCEPAY_SECRET_KEY: "k",
    COMMERCEPAY_BASE_URL: "https://x.test/",
  })
  assert.equal(full?.baseUrl, "https://x.test")
})

test("authenticates once, caches the token, and signs the session call", async () => {
  const gw = gateway([
    AUTH_OK,
    { status: 200, body: { redirectionType: 1, redirectUrl: "https://pay.test/s/1", sessionNumber: "S1" } },
    { status: 200, body: { redirectionType: 1, redirectUrl: "https://pay.test/s/2", sessionNumber: "S2" } },
  ])
  const tokens = cache()
  const client = new CommercePayClient(config, {
    fetchImpl: gw.fetchImpl,
    cache: tokens,
    now: () => 1_700_000_000_000,
  })

  const input = {
    currencyCode: "MYR",
    amount: 120000,
    referenceCode: "PI-2026-09-014-1",
    description: "Renewal PI-2026/09-014",
    ipAddress: "203.0.113.9",
    userAgent: "test",
    returnUrl: "https://sims.test/renew/abc/receipt",
    callbackUrl: "https://sims.test/api/public/commercepay/callback",
    customer: { email: "owner@example.test", name: null },
    expiredInMinutes: 1440,
  }

  const first = await client.initialSession(input)
  assert.ok(first.ok)
  assert.equal(first.ok && first.result.sessionNumber, "S1")

  const second = await client.initialSession({ ...input, referenceCode: "PI-2026-09-014-2" })
  assert.ok(second.ok)

  // One authenticate, two session calls: the token came from cache the second time.
  assert.equal(gw.calls.length, 3)
  assert.match(gw.calls[0].url, /TokenAuth\/Authenticate$/)
  assert.equal(tokens.store.get("commercepay:token:42"), "tok-1")

  // The session call carries the tenant, the bearer, and a signature computed
  // over the exact body that was sent.
  const sessionCall = gw.calls[1]
  const headers = sessionCall.init.headers as Record<string, string>
  assert.equal(headers["Abp-TenantId"], "42")
  assert.equal(headers.Authorization, "Bearer tok-1")
  const sentBody = JSON.parse(String(sessionCall.init.body)) as Record<string, unknown>
  assert.equal(
    headers["cap-signature"],
    signRequest(
      "https://staging-payments.example.test/api/services/app/PaymentGateway/InitialSession",
      sentBody as never,
      config.secretKey
    )
  )
  // A null customer name must be omitted from the signature, and the body
  // shows it as null; sortAndStripNulls handles that inside signRequest.
  assert.equal(sentBody.timestamp, 1_700_000_000_000)
})

test("a 401 on a signed call drops the cached token and retries exactly once", async () => {
  const gw = gateway([
    { status: 401, body: { error: { code: 401, message: "expired" } } },
    { status: 200, body: { accessToken: "tok-2", expireInSeconds: 86400 } },
    { status: 200, body: { transactionNumber: "T1", status: 1, amount: 120000, referenceCode: "R" } },
  ])
  const tokens = cache()
  tokens.store.set("commercepay:token:42", "stale")
  const client = new CommercePayClient(config, { fetchImpl: gw.fetchImpl, cache: tokens })

  const outcome = await client.queryPayment({ transactionNumber: "T1" })
  assert.ok(outcome.ok)
  assert.equal(outcome.ok && outcome.result.status, 1)
  assert.equal(tokens.store.get("commercepay:token:42"), "tok-2")
  assert.equal(gw.calls.length, 3)
  // The query string uses the documented PascalCase parameter names.
  assert.match(gw.calls[0].url, /Query\?TransactionNumber=T1&Timestamp=\d+$/)
})

test("a second 401 is reported, not retried forever", async () => {
  const gw = gateway([
    { status: 401, body: {} },
    AUTH_OK,
    { status: 401, body: { error: { code: 401, message: "still no" } } },
  ])
  const tokens = cache()
  tokens.store.set("commercepay:token:42", "stale")
  const client = new CommercePayClient(config, { fetchImpl: gw.fetchImpl, cache: tokens })
  const outcome = await client.queryPayment({ sessionNumber: "S9" })
  assert.equal(outcome.ok, false)
  assert.equal(gw.calls.length, 3)
})

test("a rejected signature arriving with success:true is still a failure", async () => {
  const gw = gateway([
    AUTH_OK,
    { status: 400, body: { result: { code: 1, message: "Invalid Signature." }, success: true } },
  ])
  const client = new CommercePayClient(config, { fetchImpl: gw.fetchImpl, cache: cache() })
  const outcome = await client.queryPayment({ sessionNumber: "S1" })
  assert.equal(outcome.ok, false)
  assert.equal(!outcome.ok && outcome.isSignatureFailure, true)
})

test("a network failure is an outcome, never an exception", async () => {
  const fetchImpl: typeof fetch = async () => {
    throw new TypeError("fetch failed")
  }
  const client = new CommercePayClient(config, { fetchImpl, cache: cache() })
  const outcome = await client.initialSession({
    currencyCode: "MYR",
    amount: 1,
    referenceCode: "R",
    description: null,
    ipAddress: "1.1.1.1",
    userAgent: null,
    returnUrl: "https://x",
    callbackUrl: "https://y",
    customer: null,
    expiredInMinutes: 10,
  })
  assert.equal(outcome.ok, false)
  assert.match(!outcome.ok ? outcome.message : "", /reach the payment gateway/)
})

test("a query with neither identifier is refused locally", async () => {
  const gw = gateway([])
  const client = new CommercePayClient(config, { fetchImpl: gw.fetchImpl, cache: cache() })
  const outcome = await client.queryPayment({})
  assert.equal(outcome.ok, false)
  assert.equal(gw.calls.length, 0)
})
