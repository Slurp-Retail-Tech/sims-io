import { AsyncLocalStorage } from "node:async_hooks"
import { randomUUID } from "node:crypto"

/**
 * Per-request context, carried implicitly so a log line written deep in a
 * helper can be tied back to the request that caused it without threading an
 * id through every signature.
 *
 * Deliberately split from `api-request-context.ts`: that file imports
 * `next/server`, which cannot be loaded under `node --test`. Everything
 * testable lives here.
 */
export type RequestContext = {
  requestId: string
  route: string
}

const storage = new AsyncLocalStorage<RequestContext>()

export function runWithRequestContext<T>(
  context: RequestContext,
  work: () => T
): T {
  return storage.run(context, work)
}

/** Null outside a request, which is the normal case for scripts and jobs. */
export function getRequestContext(): RequestContext | null {
  return storage.getStore() ?? null
}

/** Anything longer or stranger than this is not a correlation id we trust. */
const MAX_INBOUND_ID_LENGTH = 128
const SAFE_ID = /^[A-Za-z0-9._@=+/-]+$/

/**
 * Honour an inbound `x-request-id` so a trace started at the proxy continues
 * here, but only when it is short and plainly formatted — the value is
 * attacker-controlled and ends up in log lines, where an unbounded or
 * newline-bearing string could forge entries or bloat storage.
 */
export function resolveRequestId(headerValue: string | null): string {
  const candidate = headerValue?.trim() ?? ""
  if (
    candidate.length > 0 &&
    candidate.length <= MAX_INBOUND_ID_LENGTH &&
    SAFE_ID.test(candidate)
  ) {
    return candidate
  }
  return randomUUID()
}
