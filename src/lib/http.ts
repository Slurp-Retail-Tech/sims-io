/**
 * One outbound HTTP client for every server-side integration.
 *
 * Node's `fetch` has no default timeout, so before this existed a hung upstream
 * held a request (or an import job) open indefinitely. Only 2 of the 23 server
 * fetch sites set one.
 *
 * Design constraint that makes adoption mechanical: `httpFetch` returns the
 * `Response` and **never throws on a non-2xx status**. It throws only
 * `HttpTimeoutError` or the underlying network error — exactly what bare
 * `fetch` does. Every call site keeps its own `if (!response.ok)` handling,
 * whether that throws, returns a result union, or hands the raw `Response`
 * back, so swapping `fetch` for `httpFetch` changes timing behaviour and
 * nothing else.
 */

/** Applied when a call does not specify `timeoutMs`. */
export const DEFAULT_TIMEOUT_MS = 10_000

/** Base for the jittered exponential backoff between retries. */
export const DEFAULT_RETRY_BASE_MS = 250

/** Ceiling on a single backoff wait, including one derived from `Retry-After`. */
export const MAX_BACKOFF_MS = 30_000

/** Thrown when a request exceeded its own `timeoutMs`, not a caller's abort. */
export class HttpTimeoutError extends Error {
  readonly label: string
  readonly timeoutMs: number

  constructor(label: string, timeoutMs: number) {
    super(`${label} timed out after ${timeoutMs}ms`)
    this.name = "HttpTimeoutError"
    this.label = label
    this.timeoutMs = timeoutMs
  }
}

export type HttpAttemptOutcome =
  | { kind: "response"; response: Response; attempt: number }
  | { kind: "error"; error: unknown; attempt: number }

export type HttpRequestOptions = RequestInit & {
  /**
   * Short scope label used in timeout messages, e.g. "clickup.fetchTask".
   * Required so no outbound call is anonymous when it fails.
   */
  label: string
  /** Per-call ceiling in ms. `0` disables the timeout. */
  timeoutMs?: number
  /** Total attempts including the first. Defaults to 1 — retry is opt-in. */
  attempts?: number
  /** Base backoff in ms; the wait is full-jittered `base * 2^n`. */
  retryBaseMs?: number
  /** Overrides `defaultShouldRetry` for this call. */
  shouldRetry?: (outcome: HttpAttemptOutcome) => boolean
}

const IDEMPOTENT_METHODS = new Set(["GET", "HEAD", "PUT", "DELETE", "OPTIONS"])

/**
 * Retrying a POST can double-submit, so retry is gated on the method unless the
 * caller supplies its own `shouldRetry`.
 */
export function isIdempotentMethod(method: string | undefined): boolean {
  return IDEMPOTENT_METHODS.has((method ?? "GET").toUpperCase())
}

/**
 * Full jitter: a uniformly random wait in `[0, base * 2^attempt]`, capped.
 * Jitter rather than a fixed delay so a fleet of callers retrying after the
 * same upstream blip does not re-synchronise into a second thundering herd.
 */
export function computeBackoffMs(
  attempt: number,
  baseMs: number = DEFAULT_RETRY_BASE_MS,
  random: () => number = Math.random
): number {
  const ceiling = Math.min(baseMs * 2 ** Math.max(attempt, 0), MAX_BACKOFF_MS)
  return Math.round(random() * ceiling)
}

/**
 * `Retry-After` as milliseconds — either delta-seconds or an HTTP date.
 * Returns null when absent or unparseable.
 */
export function parseRetryAfterMs(
  header: string | null,
  now: number = Date.now()
): number | null {
  if (!header) {
    return null
  }
  const trimmed = header.trim()
  if (/^\d+$/.test(trimmed)) {
    return Math.min(Number(trimmed) * 1000, MAX_BACKOFF_MS)
  }
  const asDate = Date.parse(trimmed)
  if (Number.isNaN(asDate)) {
    return null
  }
  return Math.min(Math.max(asDate - now, 0), MAX_BACKOFF_MS)
}

const RETRYABLE_STATUSES = new Set([429, 502, 503, 504])

/**
 * Retry network errors, timeouts and the transient statuses — but never 500,
 * which usually means a deterministic upstream bug that a retry only repeats,
 * and never a non-idempotent method.
 */
export function defaultShouldRetry(
  outcome: HttpAttemptOutcome,
  method: string | undefined
): boolean {
  if (!isIdempotentMethod(method)) {
    return false
  }
  if (outcome.kind === "error") {
    return true
  }
  return RETRYABLE_STATUSES.has(outcome.response.status)
}

/**
 * Origin and path only — never the query string.
 *
 * Load-bearing: the POS 401 fallback puts `api_token` in the query string, so
 * logging a full URL would leak a credential into wherever logs land.
 */
export function redactUrlForLogs(input: string | URL): string {
  try {
    const url = typeof input === "string" ? new URL(input) : input
    return `${url.origin}${url.pathname}`
  } catch {
    return "[unparseable url]"
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function attemptOnce(
  input: string | URL,
  init: RequestInit,
  timeoutMs: number,
  label: string,
  fetchImpl: typeof fetch
): Promise<Response> {
  if (timeoutMs <= 0) {
    return fetchImpl(input as RequestInfo, init)
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  const callerSignal = init.signal ?? null
  const signal = callerSignal
    ? AbortSignal.any([callerSignal, controller.signal])
    : controller.signal

  try {
    return await fetchImpl(input as RequestInfo, { ...init, signal })
  } catch (error) {
    // Only our own timer counts as a timeout; a caller's abort propagates as-is
    // so cancellation is never misreported as an upstream being slow.
    if (controller.signal.aborted && !callerSignal?.aborted) {
      throw new HttpTimeoutError(label, timeoutMs)
    }
    throw error
  } finally {
    clearTimeout(timer)
  }
}

export async function httpFetch(
  input: string | URL,
  options: HttpRequestOptions,
  fetchImpl: typeof fetch = fetch
): Promise<Response> {
  const {
    label,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    attempts = 1,
    retryBaseMs = DEFAULT_RETRY_BASE_MS,
    shouldRetry,
    ...init
  } = options

  const totalAttempts = Math.max(1, attempts)
  let lastError: unknown

  for (let attempt = 0; attempt < totalAttempts; attempt += 1) {
    const isLast = attempt === totalAttempts - 1
    let outcome: HttpAttemptOutcome

    try {
      const response = await attemptOnce(
        input,
        init,
        timeoutMs,
        label,
        fetchImpl
      )
      outcome = { kind: "response", response, attempt }
    } catch (error) {
      lastError = error
      outcome = { kind: "error", error, attempt }
    }

    const retry = shouldRetry
      ? shouldRetry(outcome)
      : defaultShouldRetry(outcome, init.method)

    if (outcome.kind === "response" && (isLast || !retry)) {
      return outcome.response
    }
    if (outcome.kind === "error" && (isLast || !retry)) {
      throw outcome.error
    }

    const retryAfter =
      outcome.kind === "response"
        ? parseRetryAfterMs(outcome.response.headers.get("retry-after"))
        : null
    await delay(retryAfter ?? computeBackoffMs(attempt, retryBaseMs))
  }

  // Unreachable: the loop always returns or throws on its last attempt.
  throw lastError ?? new Error(`${label} exhausted every attempt`)
}
