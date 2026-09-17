import assert from "node:assert/strict"
import test from "node:test"

import { canStartNewSession, isTerminalState, mapPaymentStatus } from "./status.ts"

test("only code 1 is paid", () => {
  assert.equal(mapPaymentStatus(1), "paid")
  for (const code of [0, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 18]) {
    assert.notEqual(mapPaymentStatus(code), "paid", `code ${code}`)
  }
})

test("authorised is not paid and is not terminal", () => {
  // A card authorisation has not moved money. Extending a licence on it
  // would be extending on a promise.
  assert.equal(mapPaymentStatus(9), "authorized")
  assert.equal(isTerminalState("authorized"), false)
})

test("the failure family maps to failed, the cancel family to cancelled", () => {
  for (const code of [2, 4, 5, 6, 7]) {
    assert.equal(mapPaymentStatus(code), "failed", `code ${code}`)
  }
  for (const code of [3, 8, 18]) {
    assert.equal(mapPaymentStatus(code), "cancelled", `code ${code}`)
  }
  assert.equal(mapPaymentStatus(10), "expired")
})

test("every refund code lands on refunded, so a person looks at it", () => {
  for (const code of [11, 12, 13]) {
    assert.equal(mapPaymentStatus(code), "refunded", `code ${code}`)
  }
})

test("an unrecognised or missing code is unknown, never a guess", () => {
  assert.equal(mapPaymentStatus(99), "unknown")
  assert.equal(mapPaymentStatus(null), "unknown")
  assert.equal(mapPaymentStatus(undefined), "unknown")
  assert.equal(mapPaymentStatus(1.5), "unknown")
  assert.equal(isTerminalState("unknown"), false)
})

test("a new session may replace a dead attempt but not a live one", () => {
  assert.equal(canStartNewSession(null), true)
  assert.equal(canStartNewSession("failed"), true)
  assert.equal(canStartNewSession("cancelled"), true)
  assert.equal(canStartNewSession("expired"), true)
  assert.equal(canStartNewSession("pending"), false)
  assert.equal(canStartNewSession("authorized"), false)
  assert.equal(canStartNewSession("paid"), false)
})
