/**
 * Pure decision logic for the job runner.
 *
 * Kept free of every runtime import so it can be unit-tested under
 * `node --test`, which cannot load `next/server`, `server-only` or a database.
 * The SQL that uses these values lives in `job-runner.ts`.
 */

/** Wall-clock a single slice may spend before it must yield. */
export const DEFAULT_SLICE_BUDGET_MS = 45_000

/**
 * Added to the slice budget when sizing a lease. The margin is what removes the
 * need for a heartbeat timer: a slice that cannot checkpoint within
 * budget + margin is genuinely wedged and *should* be reaped.
 */
export const DEFAULT_LEASE_MARGIN_SECONDS = 30

/** Reserved at the end of a slice so it can always afford a final checkpoint. */
export const CHECKPOINT_RESERVE_MS = 3_000

export const DEFAULT_FLUSH_INTERVAL_MS = 2_000
export const DEFAULT_FLUSH_UNIT_THRESHOLD = 50

/** Ceiling on reclaim backoff, so a repeatedly-failing job still gets retried. */
export const MAX_RECLAIM_BACKOFF_SECONDS = 300

export type FlushReason = "time" | "units" | "final" | null

export type FlushDecision = {
  flush: boolean
  reason: FlushReason
}

/**
 * Whether pending progress should be written now.
 *
 * Bounded on purpose: the writer this replaces issued one full-summary UPDATE
 * per row, re-serializing a JSON blob that grew with the run.
 */
export function shouldFlush(input: {
  pendingUnits: number
  lastFlushAtMs: number
  nowMs: number
  flushIntervalMs?: number
  flushUnitThreshold?: number
  isFinal?: boolean
}): FlushDecision {
  const {
    pendingUnits,
    lastFlushAtMs,
    nowMs,
    flushIntervalMs = DEFAULT_FLUSH_INTERVAL_MS,
    flushUnitThreshold = DEFAULT_FLUSH_UNIT_THRESHOLD,
    isFinal = false,
  } = input

  // A final flush runs even with nothing pending: it is what marks the run
  // terminal, and skipping it would strand the row as `running`.
  if (isFinal) {
    return { flush: true, reason: "final" }
  }
  if (pendingUnits <= 0) {
    return { flush: false, reason: null }
  }
  if (pendingUnits >= flushUnitThreshold) {
    return { flush: true, reason: "units" }
  }
  if (nowMs - lastFlushAtMs >= flushIntervalMs) {
    return { flush: true, reason: "time" }
  }
  return { flush: false, reason: null }
}

/** A lease with no expiry is not held; one whose expiry has passed is stale. */
export function isLeaseStale(
  leaseExpiresAtMs: number | null,
  nowMs: number
): boolean {
  if (leaseExpiresAtMs === null) {
    return true
  }
  return leaseExpiresAtMs < nowMs
}

/**
 * Always strictly greater than the slice budget — the invariant that lets a
 * checkpoint double as the lease renewal and makes a heartbeat unnecessary.
 */
export function computeLeaseSeconds(
  sliceBudgetMs: number = DEFAULT_SLICE_BUDGET_MS,
  marginSeconds: number = DEFAULT_LEASE_MARGIN_SECONDS
): number {
  return Math.ceil(sliceBudgetMs / 1000) + Math.max(marginSeconds, 1)
}

/** Exponential backoff on reclaim, capped so a run is never parked forever. */
export function reclaimBackoffSeconds(
  attempt: number,
  options: { baseSeconds?: number; maxSeconds?: number } = {}
): number {
  const { baseSeconds = 10, maxSeconds = MAX_RECLAIM_BACKOFF_SECONDS } = options
  const raw = baseSeconds * 2 ** Math.max(attempt - 1, 0)
  return Math.min(Math.round(raw), maxSeconds)
}

export function shouldGiveUp(attempt: number, maxAttempts: number): boolean {
  return attempt >= maxAttempts
}

/**
 * Whether there is room for another unit AND the checkpoint that must follow
 * it. Reserving the checkpoint is the point: a slice that spends its last
 * millisecond on work would have nowhere to record having done it.
 */
export function hasBudget(
  deadlineAtMs: number,
  nowMs: number,
  reserveMs: number = CHECKPOINT_RESERVE_MS
): boolean {
  return deadlineAtMs - nowMs > reserveMs
}
