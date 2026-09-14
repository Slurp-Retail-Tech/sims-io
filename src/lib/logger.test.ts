import assert from "node:assert/strict"
import test from "node:test"

import { formatLogLine, redactFields, serializeError } from "./logger.ts"

const TS = "2026-08-29T12:00:00.000Z"

test("redactFields drops credential-bearing values but keeps their keys", () => {
  // Keys survive so a reader can see a value was present and withheld.
  assert.deepEqual(
    redactFields({
      userId: "42",
      password: "hunter2",
      apiToken: "abc",
      ACCESS_TOKEN: "def",
      Cookie: "sims-auth=x",
      merchantName: "Teh Tarik House",
    }),
    {
      userId: "42",
      password: "[redacted]",
      apiToken: "[redacted]",
      ACCESS_TOKEN: "[redacted]",
      Cookie: "[redacted]",
      merchantName: "Teh Tarik House",
    }
  )
})

test("serializeError handles Errors, strings and anything else", () => {
  const err = new Error("boom")
  const serialized = serializeError(err)
  assert.equal(serialized.name, "Error")
  assert.equal(serialized.message, "boom")
  assert.ok(serialized.stack)

  assert.deepEqual(serializeError("plain"), { name: "Error", message: "plain" })
  assert.deepEqual(serializeError(null), { name: "Error", message: "null" })
  assert.deepEqual(serializeError(42), { name: "Error", message: "42" })
})

test("serializeError carries a Node error code through", () => {
  // Codes like ECONNREFUSED are the most filterable thing in the line.
  const err: NodeJS.ErrnoException = new Error("nope")
  err.code = "ECONNREFUSED"
  assert.equal(serializeError(err).code, "ECONNREFUSED")
})

test("the production line is one parseable JSON object", () => {
  const line = formatLogLine({
    level: "error",
    scope: "tickets",
    message: "update failed",
    timestamp: TS,
    requestId: "req-1",
    route: "/api/tickets/[ticketId]",
    fields: { ticketId: "42" },
    error: new Error("boom"),
  })

  assert.equal(line.includes("\n"), false, "a log line must not contain newlines")
  const parsed = JSON.parse(line)
  assert.equal(parsed.ts, TS)
  assert.equal(parsed.level, "error")
  assert.equal(parsed.scope, "tickets")
  assert.equal(parsed.msg, "update failed")
  assert.equal(parsed.requestId, "req-1")
  assert.equal(parsed.route, "/api/tickets/[ticketId]")
  assert.equal(parsed.ticketId, "42")
  assert.equal(parsed.err.message, "boom")
})

test("the JSON line redacts fields too", () => {
  const parsed = JSON.parse(
    formatLogLine({
      level: "info",
      scope: "auth",
      message: "login",
      timestamp: TS,
      fields: { email: "a@b.com", password: "hunter2" },
    })
  )
  assert.equal(parsed.email, "a@b.com")
  assert.equal(parsed.password, "[redacted]")
})

test("omitted context and fields leave no empty keys behind", () => {
  const parsed = JSON.parse(
    formatLogLine({ level: "info", scope: "app", message: "hi", timestamp: TS })
  )
  assert.deepEqual(Object.keys(parsed), ["ts", "level", "scope", "msg"])
})

test("the development line stays readable", () => {
  const line = formatLogLine({
    level: "error",
    scope: "tickets",
    message: "update failed",
    timestamp: TS,
    requestId: "req-1",
    pretty: true,
  })
  assert.match(line, /^\[tickets\] update failed \(req-1\)/)
})
