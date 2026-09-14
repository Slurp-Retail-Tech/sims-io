import assert from "node:assert/strict"
import test from "node:test"

import {
  getRequestContext,
  resolveRequestId,
  runWithRequestContext,
} from "./request-context.ts"

test("resolveRequestId honours a well-formed inbound id", () => {
  // A trace started at the proxy should continue here rather than restarting.
  assert.equal(resolveRequestId("abc-123"), "abc-123")
  assert.equal(resolveRequestId("  abc-123  "), "abc-123")
})

test("resolveRequestId mints one when the header is absent or empty", () => {
  const minted = resolveRequestId(null)
  assert.match(minted, /^[0-9a-f-]{36}$/)
  assert.match(resolveRequestId("   "), /^[0-9a-f-]{36}$/)
})

test("resolveRequestId rejects ids that could forge or bloat a log line", () => {
  // The header is attacker-controlled and lands in log output.
  const withNewline = resolveRequestId('abc\n{"level":"error","msg":"forged"}')
  assert.match(withNewline, /^[0-9a-f-]{36}$/)

  const tooLong = resolveRequestId("a".repeat(129))
  assert.match(tooLong, /^[0-9a-f-]{36}$/)

  // 128 is the boundary and is accepted.
  assert.equal(resolveRequestId("a".repeat(128)), "a".repeat(128))
})

test("getRequestContext is null outside a request", () => {
  assert.equal(getRequestContext(), null)
})

test("context is visible to code called inside the scope", () => {
  const seen = runWithRequestContext(
    { requestId: "req-1", route: "/api/things" },
    () => {
      const nested = () => getRequestContext()
      return nested()
    }
  )
  assert.deepEqual(seen, { requestId: "req-1", route: "/api/things" })
})

test("context survives an await and does not leak out of the scope", async () => {
  const inside = await runWithRequestContext(
    { requestId: "req-2", route: "/api/async" },
    async () => {
      await new Promise((resolve) => setTimeout(resolve, 1))
      return getRequestContext()?.requestId
    }
  )
  assert.equal(inside, "req-2")
  assert.equal(getRequestContext(), null)
})
