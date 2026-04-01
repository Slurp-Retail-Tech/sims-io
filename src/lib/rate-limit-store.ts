import { createClient } from "redis"

type RateLimitStoreResult = {
  count: number
  retryAfterSeconds: number
}

type MemoryEntry = {
  count: number
  resetAt: number
}

const memoryStore = new Map<string, MemoryEntry>()
type AppRedisClient = ReturnType<typeof createClient>

let redisClientPromise: Promise<AppRedisClient> | null = null

function getRedisUrl() {
  return process.env.REDIS_URL?.trim() ?? ""
}

async function getRedisClient() {
  if (redisClientPromise) {
    return redisClientPromise
  }

  const url = getRedisUrl()
  if (!url) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("REDIS_URL is required for rate limiting in production.")
    }
    return null
  }

  const client = createClient({ url })
  client.on("error", (error) => {
    console.error("Redis rate limit error:", error)
  })
  redisClientPromise = client
    .connect()
    .then(() => client)
    .catch((error) => {
      redisClientPromise = null
      throw error
    })
  return redisClientPromise
}

function incrementMemoryKey(key: string, windowSeconds: number): RateLimitStoreResult {
  const now = Date.now()
  const existing = memoryStore.get(key)

  if (!existing || existing.resetAt <= now) {
    const resetAt = now + windowSeconds * 1000
    memoryStore.set(key, { count: 1, resetAt })
    return { count: 1, retryAfterSeconds: windowSeconds }
  }

  existing.count += 1
  return {
    count: existing.count,
    retryAfterSeconds: Math.max(1, Math.ceil((existing.resetAt - now) / 1000)),
  }
}

setInterval(() => {
  const now = Date.now()
  memoryStore.forEach((entry, key) => {
    if (entry.resetAt <= now) {
      memoryStore.delete(key)
    }
  })
}, 60_000)

export async function incrementRateLimitKey(key: string, windowSeconds: number) {
  const client = await getRedisClient()
  if (!client) {
    return incrementMemoryKey(key, windowSeconds)
  }

  const count = await client.incr(key)
  if (count === 1) {
    await client.expire(key, windowSeconds)
  }

  const ttl = await client.ttl(key)
  return {
    count,
    retryAfterSeconds: ttl > 0 ? ttl : windowSeconds,
  }
}
