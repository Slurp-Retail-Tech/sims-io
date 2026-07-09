import assert from "node:assert/strict"
import test from "node:test"

import { buildLeadWhatsappUrl, normalizeWhatsappNumber } from "./whatsapp.ts"

test("normalizeWhatsappNumber replaces a leading 0 with the default country code", () => {
  delete process.env.LEAD_WHATSAPP_COUNTRY_CODE
  assert.equal(normalizeWhatsappNumber("0123456789"), "60123456789")
})

test("normalizeWhatsappNumber leaves international-format numbers as-is", () => {
  delete process.env.LEAD_WHATSAPP_COUNTRY_CODE
  assert.equal(normalizeWhatsappNumber("60123456789"), "60123456789")
})

test("normalizeWhatsappNumber strips non-digit characters", () => {
  delete process.env.LEAD_WHATSAPP_COUNTRY_CODE
  assert.equal(normalizeWhatsappNumber("+60 12-345 6789"), "60123456789")
})

test("normalizeWhatsappNumber honours a configured country code", () => {
  process.env.LEAD_WHATSAPP_COUNTRY_CODE = "65"
  assert.equal(normalizeWhatsappNumber("091234567"), "6591234567")
  delete process.env.LEAD_WHATSAPP_COUNTRY_CODE
})

test("normalizeWhatsappNumber returns null when there are no digits", () => {
  assert.equal(normalizeWhatsappNumber("---"), null)
  assert.equal(normalizeWhatsappNumber(""), null)
})

test("buildLeadWhatsappUrl builds a wa.me link, or null when unusable", () => {
  delete process.env.LEAD_WHATSAPP_COUNTRY_CODE
  assert.equal(buildLeadWhatsappUrl("0123456789"), "https://wa.me/60123456789")
  assert.equal(buildLeadWhatsappUrl("n/a"), null)
})
