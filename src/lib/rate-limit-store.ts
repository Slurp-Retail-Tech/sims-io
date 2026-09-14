/**
 * Rate limit backing store.
 *
 * Uses Redis when REDIS_URL is configured (required in production).
 * Falls back to an in-memory Map for local development only.
 */

import { createLogger } from "./logger.ts"

type InMemoryEntry = {
  count: number
  resetAt: number // Unix ms
}

const inMemoryStore = new Map<string, InMemoryEntry>()

// Purge expired keys every 60 s to avoid unbounded growth. unref() so the
// timer never keeps a short-lived process (tests, scripts) alive.
if (typeof setInterval !== "undefined") {
  const timer = setInterval(() => {
    const now = Date.now()
    for (const [key, entry] of inMemoryStore) {
      if (entry.resetAt <= now) {
        inMemoryStore.delete(key)
      }
    }
  }, 60_000)
  if (typeof timer === "object" && "unref" in timer) {
    timer.unref()
  }
}

/** Thrown when the production store is unreachable — callers fail closed. */
export class RateLimitStoreUnavailableError extends Error {
  constructor(cause: unknown) {
    super("Rate limit store unavailable.")
    this.name = "RateLimitStoreUnavailableError"
    this.cause = cause
  }
}

// Lazily initialised Redis client so the module can be imported without
// a live Redis connection in environments where it is not needed.
let redisClient: import("redis").RedisClientType | null = null
let redisConnectPromise: Promise<void> | null = null

async function getRedisClient(): Promise<import("redis").RedisClientType> {
  if (redisClient) {
    return redisClient
  }

  // Dynamic import so the module still loads when the package is absent in
  // development (the in-memory path will be used instead).
  const { createClient } = await import("redis")
  const client = createClient({ url: process.env.REDIS_URL }) as import("redis").RedisClientType

  client.on("error", (err: unknown) => {
    createLogger("rate-limit-store").error("Redis error", err)
  })

  if (!redisConnectPromise) {
    redisConnectPromise = client.connect().then(() => {
      redisClient = client
    })
  }

  await redisConnectPromise
  return client
}

/**
 * Atomic INCR + EXPIRE. A separate INCR-then-EXPIRE pair could be split by
 * a crash, leaving a counter with no TTL that blocks its bucket forever;
 * this script also self-heals any such stranded key (TTL == -1) it finds.
 */
const INCREMENT_SCRIPT = `
local count = redis.call('INCR', KEYS[1])
local ttl = redis.call('TTL', KEYS[1])
if ttl < 0 then
  redis.call('EXPIRE', KEYS[1], ARGV[1])
  ttl = tonumber(ARGV[1])
end
return {count, ttl}
`

/**
 * Increment the hit counter for `key` within a `windowSeconds`-wide window.
 *
 * Returns the new count and the number of seconds until the window resets.
 * Throws `RateLimitStoreUnavailableError` when Redis is down in production
 * so the caller can fail closed (429) instead of erroring (500).
 */
/**
 * Liveness probe for Redis, reusing the same lazily-created client the rate
 * limiter uses so a health check never opens a second connection. Throws when
 * Redis is unreachable.
 */
export async function pingRedisStore(): Promise<void> {
  const client = await getRedisClient()
  await client.ping()
}

export async function incrementRateLimitKey(
  key: string,
  windowSeconds: number
): Promise<{ count: number; retryAfterSeconds: number }> {
  if (process.env.NODE_ENV === "production" && !process.env.REDIS_URL?.trim()) {
    throw new Error(
      "[rate-limit-store] REDIS_URL must be set in production. " +
        "In-memory rate limiting is not safe for multi-process deployments."
    )
  }

  if (process.env.REDIS_URL?.trim()) {
    try {
      const client = await getRedisClient()

      const result = (await client.eval(INCREMENT_SCRIPT, {
        keys: [key],
        arguments: [String(windowSeconds)],
      })) as [number, number]

      const [count, ttl] = result
      return { count, retryAfterSeconds: ttl > 0 ? ttl : windowSeconds }
    } catch (err) {
      // If Redis is unavailable in production, fail CLOSED: the caller turns
      // this into a 429, never a 500, and never a silently unlimited request.
      if (process.env.NODE_ENV === "production") {
        throw new RateLimitStoreUnavailableError(err)
      }
      createLogger("rate-limit-store").warn(
        "Redis unavailable, falling back to in-memory store",
        { error: err instanceof Error ? err.message : String(err) }
      )
    }
  }

  // In-memory fallback (development only).
  const now = Date.now()
  const existing = inMemoryStore.get(key)

  if (existing && existing.resetAt > now) {
    existing.count += 1
    const retryAfterSeconds = Math.ceil((existing.resetAt - now) / 1000)
    return { count: existing.count, retryAfterSeconds }
  }

  const resetAt = now + windowSeconds * 1000
  inMemoryStore.set(key, { count: 1, resetAt })
  return { count: 1, retryAfterSeconds: windowSeconds }
}
