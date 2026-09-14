import assert from "node:assert/strict"
import test from "node:test"

import {
  advanceTicketCursor,
  INITIAL_CLICKUP_SYNC_CURSOR,
  parseClickUpSyncCursor,
} from "./clickup-sync-cursor.ts"

test("a full batch advances to the last id and keeps going", () => {
  const result = advanceTicketCursor(
    INITIAL_CLICKUP_SYNC_CURSOR,
    [{ id: "10" }, { id: "11" }, { id: "12" }],
    3
  )
  assert.deepEqual(result, { cursor: { afterTicketId: "12" }, done: false })
})

test("a short batch is terminal", () => {
  const result = advanceTicketCursor(
    { afterTicketId: "9" },
    [{ id: "10" }, { id: "11" }],
    3
  )
  assert.deepEqual(result, { cursor: { afterTicketId: "11" }, done: true })
})

test("an empty batch is terminal and leaves the cursor alone", () => {
  const cursor = { afterTicketId: "42" }
  assert.deepEqual(advanceTicketCursor(cursor, [], 100), { cursor, done: true })
})

test("ids are carried as strings and never coerced to numbers", () => {
  // tickets.id is a BIGINT and the pool returns bigNumberStrings; going through
  // Number would silently lose precision past 2^53.
  const big = "9007199254740993"
  const result = advanceTicketCursor(INITIAL_CLICKUP_SYNC_CURSOR, [{ id: big }], 10)
  assert.equal(result.cursor.afterTicketId, big)
  assert.equal(typeof result.cursor.afterTicketId, "string")
})

test("a malformed stored cursor falls back to the start", () => {
  assert.deepEqual(parseClickUpSyncCursor(null), INITIAL_CLICKUP_SYNC_CURSOR)
  assert.deepEqual(parseClickUpSyncCursor({}), INITIAL_CLICKUP_SYNC_CURSOR)
  assert.deepEqual(
    parseClickUpSyncCursor({ afterTicketId: 42 }),
    INITIAL_CLICKUP_SYNC_CURSOR
  )
  assert.deepEqual(parseClickUpSyncCursor({ afterTicketId: "" }), INITIAL_CLICKUP_SYNC_CURSOR)
})

test("a valid stored cursor round-trips", () => {
  assert.deepEqual(parseClickUpSyncCursor({ afterTicketId: "77" }), {
    afterTicketId: "77",
  })
})
