import { authenticatePosApiSession } from "./pos-api.ts"
import type { PosApiAuthSession } from "./pos-api.ts"
import { createLogger } from "./logger.ts"

const log = createLogger("pos-session")

/**
 * A POS session that refreshes itself.
 *
 * The PLUS update captured one session before its row loop and used that token
 * for the whole run, so a long import started failing every remaining row once
 * the token's TTL expired — with nothing in the error to say why.
 */
export type PosSessionHolder = {
  /** Re-authenticates when the cached session is older than maxAgeMs. */
  get: () => Promise<PosApiAuthSession>
  /** Force a re-auth after a 401. Concurrent callers share one login. */
  refresh: () => Promise<PosApiAuthSession>
}

function resolveMaxAgeMs(): number {
  const raw = Number(process.env.POS_SESSION_MAX_AGE_MS ?? 600_000)
  return Number.isFinite(raw) && raw > 0 ? raw : 600_000
}

export function createPosSessionHolder(
  options: {
    maxAgeMs?: number
    authenticate?: () => Promise<PosApiAuthSession>
    now?: () => number
  } = {}
): PosSessionHolder {
  const maxAgeMs = options.maxAgeMs ?? resolveMaxAgeMs()
  const authenticate = options.authenticate ?? authenticatePosApiSession
  const now = options.now ?? Date.now

  let cached: PosApiAuthSession | null = null
  let issuedAt = 0
  // Coalesces concurrent refreshes into one login: without it, a burst of 401s
  // would each trigger their own, and POS rate-limits authentication.
  let inFlight: Promise<PosApiAuthSession> | null = null

  const login = async (): Promise<PosApiAuthSession> => {
    if (inFlight) {
      return inFlight
    }
    inFlight = (async () => {
      try {
        const session = await authenticate()
        cached = session
        issuedAt = now()
        return session
      } finally {
        inFlight = null
      }
    })()
    return inFlight
  }

  return {
    async get() {
      if (cached && now() - issuedAt < maxAgeMs) {
        return cached
      }
      return login()
    },
    async refresh() {
      log.info("Refreshing POS session")
      cached = null
      return login()
    },
  }
}
