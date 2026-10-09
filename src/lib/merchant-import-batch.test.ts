import assert from "node:assert/strict"
import test from "node:test"

import {
  buildMerchantUpsert,
  buildOutletUpsert,
  chunk,
  upsertWithRowFallback,
} from "./merchant-import-batch.ts"
import type { SqlStatement } from "./merchant-import-batch.ts"

function merchant(id: string) {
  return {
    externalId: id,
    name: `Merchant ${id}`,
    fid: id,
    outletCount: 1,
    status: "Active",
    rawPayload: "{}",
  }
}

function dataError(): Error {
  return Object.assign(new Error("Data too long for column 'name'"), {
    code: "ER_DATA_TOO_LONG",
  })
}

test("chunk splits into bounded groups and keeps order", () => {
  assert.deepEqual(chunk([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]])
  assert.deepEqual(chunk([], 500), [])
  assert.throws(() => chunk([1], 0))
})

test("buildMerchantUpsert writes every row in one statement", () => {
  const statement = buildMerchantUpsert([merchant("1"), merchant("2")])
  assert.equal(statement.sql.match(/\(\?, \?, \?, \?, \?, \?\)/g)?.length, 2)
  assert.deepEqual(statement.values, [
    "1", "Merchant 1", "1", 1, "Active", "{}",
    "2", "Merchant 2", "2", 1, "Active", "{}",
  ])
  assert.match(statement.sql, /ON DUPLICATE KEY UPDATE/)
})

test("buildOutletUpsert carries the owning merchant id per row", () => {
  const statement = buildOutletUpsert([
    { externalId: "o1", merchantExternalId: "m1", name: "A", status: null, rawPayload: "{}" },
    { externalId: "o2", merchantExternalId: "m2", name: "B", status: "1", rawPayload: "{}" },
  ])
  assert.equal(statement.sql.match(/\(\?, \?, \?, \?, \?\)/g)?.length, 2)
  assert.deepEqual(statement.values, ["o1", "m1", "A", null, "{}", "o2", "m2", "B", "1", "{}"])
})

test("builders refuse an empty batch rather than emit invalid SQL", () => {
  assert.throws(() => buildMerchantUpsert([]))
  assert.throws(() => buildOutletUpsert([]))
})

test("a clean batch costs exactly one statement", async () => {
  const run: SqlStatement[] = []
  const failures = await upsertWithRowFallback(
    async (statement) => { run.push(statement) },
    [merchant("1"), merchant("2"), merchant("3")],
    buildMerchantUpsert
  )
  assert.deepEqual(failures, [])
  assert.equal(run.length, 1)
})

test("a rejected batch is replayed row by row and only the bad row is lost", async () => {
  const written: string[] = []
  const failures = await upsertWithRowFallback(
    async (statement) => {
      const ids = statement.values.filter((_, index) => index % 6 === 0)
      if (ids.includes("bad")) {
        throw dataError()
      }
      written.push(...(ids as string[]))
    },
    [merchant("1"), merchant("bad"), merchant("3")],
    buildMerchantUpsert
  )
  assert.deepEqual(written, ["1", "3"])
  assert.equal(failures.length, 1)
  assert.equal(failures[0].row.externalId, "bad")
  assert.match(failures[0].reason, /Data too long/)
})

test("a single-row batch that fails is reported without a retry", async () => {
  let calls = 0
  const failures = await upsertWithRowFallback(
    async () => { calls += 1; throw dataError() },
    [merchant("bad")],
    buildMerchantUpsert
  )
  assert.equal(calls, 1)
  assert.equal(failures.length, 1)
})

test("errors that are not about a row's data are rethrown, not skipped", async () => {
  const lost = Object.assign(new Error("Connection lost"), { code: "PROTOCOL_CONNECTION_LOST" })
  await assert.rejects(
    upsertWithRowFallback(async () => { throw lost }, [merchant("1"), merchant("2")], buildMerchantUpsert),
    /Connection lost/
  )
  // Also during the per-row replay.
  let calls = 0
  await assert.rejects(
    upsertWithRowFallback(
      async () => {
        calls += 1
        throw calls === 1 ? dataError() : lost
      },
      [merchant("1"), merchant("2")],
      buildMerchantUpsert
    ),
    /Connection lost/
  )
})

test("an empty batch issues no statement", async () => {
  let calls = 0
  assert.deepEqual(
    await upsertWithRowFallback(async () => { calls += 1 }, [], buildMerchantUpsert),
    []
  )
  assert.equal(calls, 0)
})
