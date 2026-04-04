import { incrementRateLimitKey } from "@/lib/rate-limit-store"

export type RateLimitResult =
  | { allowed: true }
  | { allowed: false; retryAfterSeconds: number }

/**
 * Check whether `key` is within the allowed request budget.
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
  const { count, retryAfterSeconds } = await incrementRateLimitKey(
    key,
    windowSeconds
  )

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
 */
export function getRateLimitIp(request: Request): string {
  if (process.env.TRUSTED_PROXY?.trim()) {
    const forwarded = request.headers.get("x-forwarded-for")
    if (forwarded) {
      // x-forwarded-for may be a comma-separated list; the leftmost entry is
      // the originating client as seen by the first trusted proxy.
      const firstIp = forwarded.split(",")[0].trim()
      if (firstIp) {
        return firstIp
      }
    }
  }

  return "direct"
}
