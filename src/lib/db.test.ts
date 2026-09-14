import assert from "node:assert/strict"
import test from "node:test"

import { withTransaction } from "./db.ts"

type Call = string

function createStubPool(options: { failCommit?: boolean; failRollback?: boolean } = {}) {
  const calls: Call[] = []
  const connection = {
    async beginTransaction() { calls.push("begin") },
    async commit() {
      calls.push("commit")
      if (options.failCommit) throw new Error("commit exploded")
    },
    async rollback() {
      calls.push("rollback")
      if (options.failRollback) throw new Error("rollback exploded")
    },
    release() { calls.push("release") },
    async query() { return [[], []] },
  }
  const pool = {
    async getConnection() {
      calls.push("getConnection")
      return connection
    },
  }
  return { calls, pool: pool as never }
}

test("commits and releases on success, returning the callback value", async () => {
  const { calls, pool } = createStubPool()

  const result = await withTransaction(async () => "ok", pool)

  assert.equal(result, "ok")
  assert.deepEqual(calls, ["getConnection", "begin", "commit", "release"])
})

test("rolls back and releases when the callback throws, rethrowing the cause", async () => {
  const { calls, pool } = createStubPool()

  await assert.rejects(
    withTransaction(async () => {
      throw new Error("work failed")
    }, pool),
    /work failed/
  )
  assert.deepEqual(calls, ["getConnection", "begin", "rollback", "release"])
})

test("a throwing rollback does not mask the original error", async () => {
  // A dead connection makes rollback throw. Letting that surface would erase
  // the real cause and send anyone debugging it to the wrong place.
  const { calls, pool } = createStubPool({ failRollback: true })

  await assert.rejects(
    withTransaction(async () => {
      throw new Error("the real cause")
    }, pool),
    /the real cause/
  )
  assert.deepEqual(calls, ["getConnection", "begin", "rollback", "release"])
})

test("a failing commit rolls back and still releases the connection", async () => {
  const { calls, pool } = createStubPool({ failCommit: true })

  await assert.rejects(withTransaction(async () => "unused", pool), /commit exploded/)
  assert.deepEqual(calls, ["getConnection", "begin", "commit", "rollback", "release"])
})

test("does not retry the callback — a mid-transaction failure is not replayed", async () => {
  // Retrying inside an open transaction would run the remaining statements on
  // a fresh connection under autocommit. Retry belongs to the caller.
  const { pool } = createStubPool()
  let attempts = 0

  await assert.rejects(
    withTransaction(async () => {
      attempts += 1
      const error: NodeJS.ErrnoException = new Error("lost")
      error.code = "PROTOCOL_CONNECTION_LOST"
      throw error
    }, pool),
    /lost/
  )
  assert.equal(attempts, 1)
})
