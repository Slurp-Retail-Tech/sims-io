import { incrementRateLimitKey } from "@/lib/rate-limit-store"

export type RateLimitResult =
  | { allowed: true }
  | { allowed: false; retryAfterSeconds: number }

export async function checkRateLimit(
  key: string,
  maxRequests: number,
  windowSeconds: number
): Promise<RateLimitResult> {
  const result = await incrementRateLimitKey(key, windowSeconds)

  if (result.count > maxRequests) {
    return {
      allowed: false,
      retryAfterSeconds: result.retryAfterSeconds,
    }
  }

  return { allowed: true }
}

export function getRateLimitIp(request: Request): string {
  const trustedProxy = process.env.TRUSTED_PROXY?.trim()
  if (trustedProxy) {
    const forwarded = (request.headers as Headers).get("x-forwarded-for")
    if (forwarded) {
      return forwarded.split(",")[0].trim() || "unknown"
    }
  }
  // Fall back to a direct connection identifier.
  // In Next.js route handlers the real socket IP is not exposed,
  // so without a trusted proxy we key on a constant to avoid header spoofing.
  return "direct"
}
