import { createLogger } from "./logger.ts"
import {
  incrementRateLimitKey,
  RateLimitStoreUnavailableError,
} from "./rate-limit-store.ts"

export type RateLimitResult =
  | { allowed: true }
  | { allowed: false; retryAfterSeconds: number }

/** Retry-After to advertise when the store itself is down (fail closed). */
const STORE_UNAVAILABLE_RETRY_SECONDS = 30

/**
 * Check whether `key` is within the allowed request budget.
 *
 * When the backing store is unreachable in production this fails CLOSED —
 * the request is rejected with a Retry-After, never allowed through and
 * never surfaced as a 500.
 *
 * @param key            Stable identifier (e.g. "login:192.168.1.1")
 * @param maxRequests    Maximum hits permitted inside the window
 * @param windowSeconds  Rolling window duration in seconds
 */
export async function checkRateLimit(
  key: string,
  maxRequests: number,
  windowSeconds: number
): Promise<RateLimitResult> {
  let count: number
  let retryAfterSeconds: number
  try {
    ;({ count, retryAfterSeconds } = await incrementRateLimitKey(
      key,
      windowSeconds
    ))
  } catch (error) {
    if (error instanceof RateLimitStoreUnavailableError) {
      createLogger("rate-limit").error(
        "Store unavailable; failing closed",
        error.cause
      )
      return { allowed: false, retryAfterSeconds: STORE_UNAVAILABLE_RETRY_SECONDS }
    }
    throw error
  }

  if (count > maxRequests) {
    return { allowed: false, retryAfterSeconds }
  }

  return { allowed: true }
}

/**
 * Derive the client IP to use as the rate-limit key.
 *
 * Reads `x-forwarded-for` ONLY when the `TRUSTED_PROXY` environment variable
 * is set (non-empty after trimming). Otherwise returns the literal string
 * `"direct"` to prevent header-spoofing attacks.
 *
 * NOTE: behind a proxy without TRUSTED_PROXY set, every client shares the
 * single "direct" bucket — which is why the env manifest refuses to
 * boot production without it.
 */
export function getRateLimitIp(request: Request): string {
  if (process.env.TRUSTED_PROXY?.trim()) {
    const forwarded = request.headers.get("x-forwarded-for")
    if (forwarded) {
      // x-forwarded-for may be a comma-separated list. The RIGHTMOST entry
      // is the one appended by our own trusted proxy and therefore the only
      // one the client cannot forge — the leftmost entries arrive in the
      // client's own request, so keying on them would let an attacker
      // rotate the header and dodge every per-IP bucket.
      const entries = forwarded.split(",")
      const lastIp = entries[entries.length - 1].trim()
      if (lastIp) {
        return lastIp
      }
    }
  }

  return "direct"
}

