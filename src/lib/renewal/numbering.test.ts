import assert from "node:assert/strict"
import test from "node:test"

import {
  formatInvoiceNumber,
  mintRenewalToken,
  toObjectKeySafeNumber,
} from "./numbering.ts"

test("formats a proforma number in Slurp's convention", () => {
  assert.equal(formatInvoiceNumber("PI", 2026, 9, 14), "PI-2026/09-014")
})

test("formats a tax invoice number in its own series", () => {
  assert.equal(formatInvoiceNumber("INV", 2026, 9, 1), "INV-2026/09-001")
})

test("zero-pads the month and the counter", () => {
  assert.equal(formatInvoiceNumber("PI", 2026, 1, 7), "PI-2026/01-007")
  assert.equal(formatInvoiceNumber("PI", 2026, 12, 99), "PI-2026/12-099")
})

test("lets the counter overflow past three digits rather than wrapping", () => {
  // A busy month must not silently reuse 001.
  assert.equal(formatInvoiceNumber("PI", 2026, 9, 1000), "PI-2026/09-1000")
})

test("makes a number safe to use as an object key or a path segment", () => {
  // The slash in the number is the reason this exists.
  assert.equal(toObjectKeySafeNumber("PI-2026/09-014"), "PI-2026-09-014")
  assert.equal(toObjectKeySafeNumber("INV-2026/09-001"), "INV-2026-09-001")
})

test("mints a 43-character URL-safe token", () => {
  const token = mintRenewalToken()
  assert.equal(token.length, 43)
  assert.match(token, /^[A-Za-z0-9_-]+$/)
})

test("mints a different token every time", () => {
  // Unguessable is the only protection the public pages have.
  const tokens = new Set(Array.from({ length: 200 }, () => mintRenewalToken()))
  assert.equal(tokens.size, 200)
})
