import assert from "node:assert/strict"
import test from "node:test"

import {
  checkRateLimit,
  getRateLimitIp,
} from "./rate-limit.ts"

function requestWithForwardedFor(value: string | null): Request {
  const headers = new Headers()
  if (value !== null) {
    headers.set("x-forwarded-for", value)
  }
  return new Request("http://localhost/test", { headers })
}

test("counts hits within the window and rejects over budget", async () => {
  const key = `test:${process.pid}:${Math.random()}`
  assert.deepEqual(await checkRateLimit(key, 2, 60), { allowed: true })
  assert.deepEqual(await checkRateLimit(key, 2, 60), { allowed: true })
  const third = await checkRateLimit(key, 2, 60)
  assert.equal(third.allowed, false)
  if (!third.allowed) {
    assert.ok(third.retryAfterSeconds > 0)
    assert.ok(third.retryAfterSeconds <= 60)
  }
})

test("ignores x-forwarded-for unless TRUSTED_PROXY is set", () => {
  const original = process.env.TRUSTED_PROXY
  try {
    delete process.env.TRUSTED_PROXY
    assert.equal(getRateLimitIp(requestWithForwardedFor("1.2.3.4")), "direct")

    process.env.TRUSTED_PROXY = "1"
    assert.equal(getRateLimitIp(requestWithForwardedFor("1.2.3.4")), "1.2.3.4")
    // The rightmost entry is the proxy-appended (unforgeable) one; the
    // leftmost arrives inside the client's own request.
    assert.equal(
      getRateLimitIp(requestWithForwardedFor("6.6.6.6, 10.0.0.1")),
      "10.0.0.1"
    )
    assert.equal(getRateLimitIp(requestWithForwardedFor(null)), "direct")
  } finally {
    if (original === undefined) delete process.env.TRUSTED_PROXY
    else process.env.TRUSTED_PROXY = original
  }
})
