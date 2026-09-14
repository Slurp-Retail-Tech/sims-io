import assert from "node:assert/strict"
import test from "node:test"

import { buildTicketHistoryInsert } from "./ticket-history.ts"

test("returns null for an empty batch so callers can skip the round trip", () => {
  assert.equal(buildTicketHistoryInsert("42", [], "alice"), null)
})

test("binds one tuple per entry in ticket, field, old, new, actor order", () => {
  const statement = buildTicketHistoryInsert(
    "42",
    [{ field: "status", oldValue: "Open", newValue: "In Progress" }],
    "alice"
  )

  assert.ok(statement)
  assert.match(statement.sql, /VALUES \(\?, \?, \?, \?, \?\)$/)
  assert.deepEqual(statement.values, ["42", "status", "Open", "In Progress", "alice"])
})

test("collapses many entries into one statement, values interleaved per tuple", () => {
  // The two loops this replaces issued one INSERT per changed field.
  const statement = buildTicketHistoryInsert(
    "42",
    [
      { field: "status", oldValue: "Open", newValue: "Closed" },
      { field: "ms_pic_user_id", oldValue: null, newValue: "7" },
    ],
    "respond_io"
  )

  assert.ok(statement)
  assert.equal(statement.sql.match(/\(\?, \?, \?, \?, \?\)/g)?.length, 2)
  assert.deepEqual(statement.values, [
    "42", "status", "Open", "Closed", "respond_io",
    "42", "ms_pic_user_id", null, "7", "respond_io",
  ])
})

test("newValueIsNow emits SQL NOW(3) and drops the bound value", () => {
  // The CSAT share path wrote NOW(3) directly; binding a JS timestamp instead
  // would change which clock stamps the row.
  const statement = buildTicketHistoryInsert(
    "42",
    [{ field: "csat_link_shared", oldValue: null, newValue: "ignored", newValueIsNow: true }],
    "alice"
  )

  assert.ok(statement)
  assert.match(statement.sql, /\(\?, \?, \?, NOW\(3\), \?\)/)
  assert.deepEqual(statement.values, ["42", "csat_link_shared", null, "alice"])
})

test("mixes NOW(3) and bound tuples in one statement", () => {
  const statement = buildTicketHistoryInsert(
    "42",
    [
      { field: "csat_token_generated", oldValue: null, newValue: "[generated]" },
      { field: "csat_link_shared", oldValue: null, newValue: null, newValueIsNow: true },
    ],
    "alice"
  )

  assert.ok(statement)
  assert.deepEqual(statement.values, [
    "42", "csat_token_generated", null, "[generated]", "alice",
    "42", "csat_link_shared", null, "alice",
  ])
})
