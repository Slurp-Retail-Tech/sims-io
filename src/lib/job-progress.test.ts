import assert from "node:assert/strict"
import test from "node:test"

import {
  EMPTY_PROGRESS,
  mergeProgress,
  summarizeOutcomes,
  truncateLabel,
  writeJobRunItems,
  type JobRunItemInput,
} from "./job-progress.ts"

const item = (
  unitIndex: number,
  outcome: JobRunItemInput["outcome"],
  unitKey = `F${unitIndex}`
): JobRunItemInput => ({ unitIndex, unitKey, outcome })

test("counters advance per outcome and processed tracks the total", () => {
  const merged = mergeProgress(EMPTY_PROGRESS, [
    item(0, "updated"),
    item(1, "skipped"),
    item(2, "failed"),
    item(3, "partial"),
  ])
  assert.equal(merged.processed, 4)
  assert.equal(merged.updated, 1)
  assert.equal(merged.skipped, 1)
  assert.equal(merged.failed, 1)
  assert.equal(merged.partial, 1)
})

test("progress stays a fixed size no matter how many units are folded in", () => {
  // The direct regression test for the old writer, whose persisted summary grew
  // with every row and was re-serialized on each write.
  const many = Array.from({ length: 5_000 }, (_unused, i) => item(i, "updated"))
  const merged = mergeProgress(EMPTY_PROGRESS, many)

  assert.equal(merged.processed, 5_000)
  assert.deepEqual(Object.keys(merged).sort(), Object.keys(EMPTY_PROGRESS).sort())
  assert.ok(
    JSON.stringify(merged).length < 250,
    "serialized progress must not grow with the unit count"
  )
})

test("merging does not mutate the progress it was given", () => {
  const before = { ...EMPTY_PROGRESS }
  mergeProgress(before, [item(0, "updated")])
  assert.deepEqual(before, EMPTY_PROGRESS)
})

test("currentLabel follows the last unit and is truncated", () => {
  const merged = mergeProgress(EMPTY_PROGRESS, [
    item(0, "updated", "first"),
    item(1, "updated", "last"),
  ])
  assert.equal(merged.currentLabel, "last")

  assert.equal(truncateLabel(null), null)
  assert.equal(truncateLabel("short"), "short")
  const long = truncateLabel("x".repeat(500))
  assert.equal(long?.length, 120)
  assert.ok(long?.endsWith("…"))
})

test("summarizeOutcomes counts every bucket, including empty ones", () => {
  assert.deepEqual(summarizeOutcomes([item(0, "updated"), item(1, "updated")]), {
    updated: 2,
    skipped: 0,
    failed: 0,
    partial: 0,
  })
})

test("an empty batch issues no statement at all", async () => {
  let calls = 0
  const db = {
    async query() {
      calls += 1
      return [[], []] as never
    },
  }
  await writeJobRunItems(db as never, "1", [])
  assert.equal(calls, 0)
})

test("a batch is written as one upserting statement", async () => {
  // One statement because a per-row insert is what made the old path slow;
  // upserting because a reclaimed lease replays units that were already written.
  const queries: string[] = []
  let captured: unknown[] = []
  const db = {
    async query(sql: string, values: unknown[]) {
      queries.push(sql)
      captured = values
      return [[], []] as never
    },
  }

  await writeJobRunItems(db as never, "7", [item(0, "updated"), item(1, "failed")])

  assert.equal(queries.length, 1)
  assert.equal(queries[0].match(/\(\?, \?, \?, \?, CAST\(\? AS JSON\), \?\)/g)?.length, 2)
  assert.match(queries[0], /ON DUPLICATE KEY UPDATE/)
  assert.deepEqual(captured.slice(0, 6), ["7", 0, "F0", "updated", null, null])
})

test("phases are serialized and an over-long unit key is bounded", async () => {
  let captured: unknown[] = []
  const db = {
    async query(_sql: string, values: unknown[]) {
      captured = values
      return [[], []] as never
    },
  }

  await writeJobRunItems(db as never, "7", [
    {
      unitIndex: 0,
      unitKey: "k".repeat(500),
      outcome: "partial",
      phases: { merchant_id: { state: "applied" } },
      message: "half applied",
    },
  ])

  assert.equal(String(captured[2]).length, 191)
  assert.equal(captured[4], '{"merchant_id":{"state":"applied"}}')
  assert.equal(captured[5], "half applied")
})
