/**
 * Rate limit backing store.
 *
 * Uses Redis when REDIS_URL is configured (required in production).
 * Falls back to an in-memory Map for local development only.
 *
 * NOTE: The `redis` npm package must be installed:
 *   npm install redis
 */

type InMemoryEntry = {
  count: number
  resetAt: number // Unix ms
}

const inMemoryStore = new Map<string, InMemoryEntry>()

// Purge expired keys every 60 s to avoid unbounded growth.
if (typeof setInterval !== "undefined") {
  setInterval(() => {
    const now = Date.now()
    for (const [key, entry] of inMemoryStore) {
      if (entry.resetAt <= now) {
        inMemoryStore.delete(key)
      }
    }
  }, 60_000)
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
    console.error("[rate-limit-store] Redis error:", err)
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
 * Increment the hit counter for `key` within a `windowSeconds`-wide window.
 *
 * Returns the new count and the number of seconds until the window resets.
 */
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

      // INCR is atomic; on first increment set the TTL.
      const count = await client.incr(key)
      if (count === 1) {
        await client.expire(key, windowSeconds)
      }

      const ttl = await client.ttl(key)
      const retryAfterSeconds = ttl > 0 ? ttl : windowSeconds

      return { count, retryAfterSeconds }
    } catch (err) {
      // If Redis is unavailable in production, surface the error rather than
      // silently falling through to in-memory (which would bypass limits across
      // processes).
      if (process.env.NODE_ENV === "production") {
        throw err
      }
      console.warn("[rate-limit-store] Redis unavailable, falling back to in-memory store:", err)
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
