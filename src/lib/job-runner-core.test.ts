import assert from "node:assert/strict"
import test from "node:test"

import {
  CHECKPOINT_RESERVE_MS,
  computeLeaseSeconds,
  DEFAULT_SLICE_BUDGET_MS,
  hasBudget,
  isLeaseStale,
  MAX_RECLAIM_BACKOFF_SECONDS,
  reclaimBackoffSeconds,
  shouldFlush,
  shouldGiveUp,
} from "./job-runner-core.ts"

test("a final flush happens even with nothing pending", () => {
  // It is what marks the run terminal; skipping it strands the row as running.
  assert.deepEqual(
    shouldFlush({ pendingUnits: 0, lastFlushAtMs: 0, nowMs: 0, isFinal: true }),
    { flush: true, reason: "final" }
  )
})

test("nothing pending and not final means no write", () => {
  assert.deepEqual(
    shouldFlush({ pendingUnits: 0, lastFlushAtMs: 0, nowMs: 10_000 }),
    { flush: false, reason: null }
  )
})

test("the unit threshold triggers a flush", () => {
  assert.deepEqual(
    shouldFlush({
      pendingUnits: 50,
      lastFlushAtMs: 0,
      nowMs: 1,
      flushUnitThreshold: 50,
    }),
    { flush: true, reason: "units" }
  )
})

test("the time interval triggers a flush even below the unit threshold", () => {
  // A slow job must still show progress; otherwise a long-running import looks
  // stuck to anyone watching.
  assert.deepEqual(
    shouldFlush({ pendingUnits: 1, lastFlushAtMs: 0, nowMs: 2_000 }),
    { flush: true, reason: "time" }
  )
  assert.deepEqual(
    shouldFlush({ pendingUnits: 1, lastFlushAtMs: 0, nowMs: 1_999 }),
    { flush: false, reason: null }
  )
})

test("a lease with no expiry counts as stale", () => {
  assert.equal(isLeaseStale(null, 1_000), true)
  assert.equal(isLeaseStale(999, 1_000), true)
  assert.equal(isLeaseStale(1_001, 1_000), false)
})

test("the lease always outlives the slice budget", () => {
  // This is the invariant that makes a heartbeat timer unnecessary: a
  // checkpoint renews the lease, and any slice that cannot checkpoint inside
  // budget + margin deserves to be reaped.
  for (const budgetMs of [1_000, 20_000, 45_000, 120_000]) {
    assert.ok(
      computeLeaseSeconds(budgetMs) * 1000 > budgetMs,
      `lease must exceed a ${budgetMs}ms budget`
    )
  }
  assert.equal(computeLeaseSeconds(45_000, 30), 75)
})

test("a zero margin is still forced to at least a second", () => {
  assert.ok(computeLeaseSeconds(1_000, 0) * 1000 > 1_000)
})

test("reclaim backoff grows and is capped", () => {
  assert.equal(reclaimBackoffSeconds(1), 10)
  assert.equal(reclaimBackoffSeconds(2), 20)
  assert.equal(reclaimBackoffSeconds(3), 40)
  assert.equal(reclaimBackoffSeconds(99), MAX_RECLAIM_BACKOFF_SECONDS)

  // Monotonic: a later attempt never waits less than an earlier one.
  let previous = 0
  for (let attempt = 1; attempt <= 20; attempt += 1) {
    const wait = reclaimBackoffSeconds(attempt)
    assert.ok(wait >= previous, `attempt ${attempt} waited less than ${attempt - 1}`)
    previous = wait
  }
})

test("shouldGiveUp fires only once the attempt budget is spent", () => {
  assert.equal(shouldGiveUp(4, 5), false)
  assert.equal(shouldGiveUp(5, 5), true)
  assert.equal(shouldGiveUp(6, 5), true)
})

test("hasBudget reserves room for the checkpoint that must follow", () => {
  const now = 1_000_000
  // Exactly the reserve left is not enough — the work itself needs time too.
  assert.equal(hasBudget(now + CHECKPOINT_RESERVE_MS, now), false)
  assert.equal(hasBudget(now + CHECKPOINT_RESERVE_MS + 1, now), true)
  assert.equal(hasBudget(now - 1, now), false)
})

test("a fresh slice has budget under the default settings", () => {
  const now = 1_000_000
  assert.equal(hasBudget(now + DEFAULT_SLICE_BUDGET_MS, now), true)
})
