/**
 * The one Redis client, and a small best-effort cache over it.
 *
 * Extracted from `rate-limit-store.ts` so the CommercePay token cache and the
 * rate limiter share a connection rather than each opening their own.
 *
 * Two behaviours, deliberately different:
 *
 *  - `getRedisClient` is the raw client. The rate limiter uses it and fails
 *    CLOSED when it is unreachable in production, because an unlimited
 *    endpoint is worse than a refused request.
 *  - `cacheGet` / `cacheSet` are best-effort. A cache miss is always safe for
 *    the things kept here (an access token that can be re-fetched, a
 *    per-token query throttle), so a Redis error degrades to "not cached"
 *    with a warning rather than failing the caller.
 *
 * Without `REDIS_URL` the cache is an in-memory Map, for local development
 * only. It does not survive a restart and is not shared across instances.
 */

import { createLogger } from "./logger.ts"

const log = createLogger("redis")

let redisClient: import("redis").RedisClientType | null = null
let redisConnectPromise: Promise<void> | null = null

export function isRedisConfigured(): boolean {
  return Boolean(process.env.REDIS_URL?.trim())
}

/**
 * Lazily connect and reuse. Dynamic import so the module loads without the
 * package in environments that never touch Redis.
 */
export async function getRedisClient(): Promise<import("redis").RedisClientType> {
  if (redisClient) {
    return redisClient
  }

  const { createClient } = await import("redis")
  const client = createClient({
    url: process.env.REDIS_URL,
  }) as import("redis").RedisClientType

  client.on("error", (error: unknown) => {
    log.error("Redis error", error)
  })

  if (!redisConnectPromise) {
    redisConnectPromise = client.connect().then(() => {
      redisClient = client
    })
  }

  await redisConnectPromise
  return client
}

type MemoryEntry = { value: string; expiresAt: number }
const memoryCache = new Map<string, MemoryEntry>()

/** Best-effort read. Null on miss or on any error. */
export async function cacheGet(key: string): Promise<string | null> {
  if (!isRedisConfigured()) {
    const entry = memoryCache.get(key)
    if (!entry) {
      return null
    }
    if (entry.expiresAt <= Date.now()) {
      memoryCache.delete(key)
      return null
    }
    return entry.value
  }

  try {
    const client = await getRedisClient()
    return await client.get(key)
  } catch (error) {
    log.warn("Cache read failed; treating as miss", {
      key,
      error: error instanceof Error ? error.message : String(error),
    })
    return null
  }
}

/** Best-effort write with a TTL in seconds. Never throws. */
export async function cacheSet(
  key: string,
  value: string,
  ttlSeconds: number
): Promise<void> {
  const ttl = Math.max(1, Math.floor(ttlSeconds))

  if (!isRedisConfigured()) {
    memoryCache.set(key, { value, expiresAt: Date.now() + ttl * 1000 })
    return
  }

  try {
    const client = await getRedisClient()
    await client.set(key, value, { EX: ttl })
  } catch (error) {
    log.warn("Cache write failed; value not cached", {
      key,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

/** Best-effort delete. Never throws. */
export async function cacheDelete(key: string): Promise<void> {
  if (!isRedisConfigured()) {
    memoryCache.delete(key)
    return
  }
  try {
    const client = await getRedisClient()
    await client.del(key)
  } catch (error) {
    log.warn("Cache delete failed", {
      key,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

/**
 * Set only if absent, with a TTL: a one-shot throttle.
 *
 * Returns true when this call set the key, meaning the caller won the slot.
 * Used to cap on-demand gateway queries to one per token per interval.
 * In development the in-memory map has the same semantics.
 */
export async function cacheAcquire(key: string, ttlSeconds: number): Promise<boolean> {
  const ttl = Math.max(1, Math.floor(ttlSeconds))

  if (!isRedisConfigured()) {
    const existing = memoryCache.get(key)
    if (existing && existing.expiresAt > Date.now()) {
      return false
    }
    memoryCache.set(key, { value: "1", expiresAt: Date.now() + ttl * 1000 })
    return true
  }

  try {
    const client = await getRedisClient()
    const result = await client.set(key, "1", { EX: ttl, NX: true })
    return result === "OK"
  } catch (error) {
    // If the throttle store is down, refusing is the safer default: the
    // caller falls back to the cached state rather than hammering the gateway.
    log.warn("Throttle acquire failed; refusing slot", {
      key,
      error: error instanceof Error ? error.message : String(error),
    })
    return false
  }
}
