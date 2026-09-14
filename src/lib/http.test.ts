import assert from "node:assert/strict"
import test from "node:test"

import {
  computeBackoffMs,
  defaultShouldRetry,
  DEFAULT_RETRY_BASE_MS,
  httpFetch,
  HttpTimeoutError,
  isIdempotentMethod,
  MAX_BACKOFF_MS,
  parseRetryAfterMs,
  redactUrlForLogs,
} from "./http.ts"

const URL_UNDER_TEST = "https://api.example.com/v1/things?api_token=secret"

function jsonResponse(status: number, headers: Record<string, string> = {}) {
  return new Response("{}", { status, headers })
}

test("isIdempotentMethod treats the safe verbs as retryable and POST as not", () => {
  assert.equal(isIdempotentMethod("GET"), true)
  assert.equal(isIdempotentMethod("get"), true)
  assert.equal(isIdempotentMethod(undefined), true) // fetch defaults to GET
  assert.equal(isIdempotentMethod("PUT"), true)
  assert.equal(isIdempotentMethod("POST"), false)
  assert.equal(isIdempotentMethod("PATCH"), false)
})

test("computeBackoffMs grows exponentially and stays inside the jitter window", () => {
  // random() = 1 gives the ceiling, which is what bounds the wait.
  const one = () => 1
  assert.equal(computeBackoffMs(0, 250, one), 250)
  assert.equal(computeBackoffMs(1, 250, one), 500)
  assert.equal(computeBackoffMs(2, 250, one), 1000)
  // random() = 0 is the floor: full jitter can legitimately return no wait.
  assert.equal(computeBackoffMs(5, 250, () => 0), 0)
})

test("computeBackoffMs caps runaway exponents", () => {
  assert.equal(computeBackoffMs(40, DEFAULT_RETRY_BASE_MS, () => 1), MAX_BACKOFF_MS)
})

test("parseRetryAfterMs reads delta-seconds and HTTP dates", () => {
  assert.equal(parseRetryAfterMs("2"), 2000)
  assert.equal(parseRetryAfterMs(null), null)
  assert.equal(parseRetryAfterMs("not-a-date"), null)

  const now = Date.parse("2026-08-29T00:00:00Z")
  assert.equal(parseRetryAfterMs("Sat, 29 Aug 2026 00:00:05 GMT", now), 5000)
  // A date already in the past must not produce a negative wait.
  assert.equal(parseRetryAfterMs("Sat, 29 Aug 2026 00:00:00 GMT", now + 9000), 0)
})

test("defaultShouldRetry retries transient statuses but never 500 or a POST", () => {
  const at = (status: number) =>
    ({ kind: "response", response: jsonResponse(status), attempt: 0 }) as const

  assert.equal(defaultShouldRetry(at(429), "GET"), true)
  assert.equal(defaultShouldRetry(at(503), "GET"), true)
  // 500 usually means a deterministic upstream bug; retrying just repeats it.
  assert.equal(defaultShouldRetry(at(500), "GET"), false)
  assert.equal(defaultShouldRetry(at(404), "GET"), false)
  assert.equal(defaultShouldRetry(at(200), "GET"), false)
  assert.equal(defaultShouldRetry(at(503), "POST"), false)
  assert.equal(
    defaultShouldRetry({ kind: "error", error: new Error("socket"), attempt: 0 }, "GET"),
    true
  )
})

test("redactUrlForLogs keeps origin and path but drops the query string", () => {
  // The POS 401 fallback puts api_token in the query string.
  assert.equal(redactUrlForLogs(URL_UNDER_TEST), "https://api.example.com/v1/things")
  assert.equal(redactUrlForLogs("not a url"), "[unparseable url]")
})

test("httpFetch returns non-2xx responses instead of throwing", async () => {
  // This is what makes it a drop-in: every call site keeps its own !ok handling.
  const response = await httpFetch(
    URL_UNDER_TEST,
    { label: "test" },
    async () => jsonResponse(500)
  )
  assert.equal(response.status, 500)
})

test("httpFetch makes exactly one attempt by default", async () => {
  let calls = 0
  const response = await httpFetch(
    URL_UNDER_TEST,
    { label: "test" },
    async () => {
      calls += 1
      return jsonResponse(503)
    }
  )
  assert.equal(response.status, 503)
  assert.equal(calls, 1)
})

test("httpFetch retries a transient status up to the attempt budget", async () => {
  let calls = 0
  const response = await httpFetch(
    URL_UNDER_TEST,
    { label: "test", attempts: 3, retryBaseMs: 0 },
    async () => {
      calls += 1
      return calls < 3 ? jsonResponse(503) : jsonResponse(200)
    }
  )
  assert.equal(response.status, 200)
  assert.equal(calls, 3)
})

test("httpFetch returns the last response once the budget is spent", async () => {
  let calls = 0
  const response = await httpFetch(
    URL_UNDER_TEST,
    { label: "test", attempts: 2, retryBaseMs: 0 },
    async () => {
      calls += 1
      return jsonResponse(503)
    }
  )
  assert.equal(response.status, 503)
  assert.equal(calls, 2)
})

test("httpFetch does not retry a POST even with an attempt budget", async () => {
  let calls = 0
  await httpFetch(
    URL_UNDER_TEST,
    { label: "test", method: "POST", attempts: 3, retryBaseMs: 0 },
    async () => {
      calls += 1
      return jsonResponse(503)
    }
  )
  assert.equal(calls, 1)
})

test("httpFetch throws HttpTimeoutError carrying its label and budget", async () => {
  await assert.rejects(
    httpFetch(
      URL_UNDER_TEST,
      { label: "pos.import", timeoutMs: 10 },
      (_input, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(new Error("aborted"))
          )
        })
    ),
    (error: unknown) => {
      assert.ok(error instanceof HttpTimeoutError)
      assert.equal(error.label, "pos.import")
      assert.equal(error.timeoutMs, 10)
      return true
    }
  )
})

test("httpFetch rethrows a network error rather than converting it", async () => {
  await assert.rejects(
    httpFetch(URL_UNDER_TEST, { label: "test" }, async () => {
      throw new Error("ECONNREFUSED")
    }),
    /ECONNREFUSED/
  )
})

test("httpFetch retries a network error when the budget allows", async () => {
  let calls = 0
  const response = await httpFetch(
    URL_UNDER_TEST,
    { label: "test", attempts: 2, retryBaseMs: 0 },
    async () => {
      calls += 1
      if (calls === 1) throw new Error("ECONNRESET")
      return jsonResponse(200)
    }
  )
  assert.equal(response.status, 200)
  assert.equal(calls, 2)
})

test("httpFetch honours a caller's shouldRetry over the default", async () => {
  let calls = 0
  await httpFetch(
    URL_UNDER_TEST,
    {
      label: "test",
      method: "POST",
      attempts: 2,
      retryBaseMs: 0,
      // A caller that knows its POST is idempotent can opt back in.
      shouldRetry: (outcome) =>
        outcome.kind === "response" && outcome.response.status === 503,
    },
    async () => {
      calls += 1
      return jsonResponse(503)
    }
  )
  assert.equal(calls, 2)
})

test("timeoutMs of 0 disables the timeout entirely", async () => {
  const response = await httpFetch(
    URL_UNDER_TEST,
    { label: "test", timeoutMs: 0 },
    async (_input, init) => {
      assert.equal(init?.signal, undefined)
      return jsonResponse(200)
    }
  )
  assert.equal(response.status, 200)
})
