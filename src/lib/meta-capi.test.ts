import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import test from "node:test"

import { buildLeadEvent, deriveFbc, hashNormalized, hashPhone, type LeadConversionInput } from "./meta-capi.ts"

const sha256 = (value: string) => createHash("sha256").update(value).digest("hex")

const baseInput: LeadConversionInput = {
  eventId: "evt-123",
  eventSourceUrl: "https://sims.example/demoform/web",
  clientIpAddress: "203.0.113.7",
  clientUserAgent: "Mozilla/5.0",
  telephone: "0123456789",
  name: "Ada Lovelace",
  fbc: null,
  fbp: "fb.1.100.200",
  fbclid: "click-abc",
  source: "web",
  businessType: "Restaurant",
  language: "en",
}

test("hashNormalized lower-cases, trims, and SHA-256s", () => {
  delete process.env.LEAD_WHATSAPP_COUNTRY_CODE
  assert.equal(hashNormalized("  Ada  "), sha256("ada"))
  assert.equal(hashNormalized(""), null)
  assert.equal(hashNormalized(null), null)
})

test("hashPhone normalises to country-coded digits before hashing", () => {
  delete process.env.LEAD_WHATSAPP_COUNTRY_CODE
  assert.equal(hashPhone("0123456789"), sha256("60123456789"))
  assert.equal(hashPhone("n/a"), null)
})

test("deriveFbc prefers the cookie, else synthesises from fbclid", () => {
  assert.equal(deriveFbc("fb.1.5.existing", "click-abc", 1000), "fb.1.5.existing")
  assert.equal(deriveFbc(null, "click-abc", 1000), "fb.1.1000.click-abc")
  assert.equal(deriveFbc(null, null, 1000), null)
})

test("buildLeadEvent hashes PII, keeps ip/ua/fbc/fbp raw, and sets custom data", () => {
  delete process.env.LEAD_WHATSAPP_COUNTRY_CODE
  const event = buildLeadEvent(baseInput, 1_700_000_000_000)

  assert.equal(event.event_name, "Lead")
  assert.equal(event.event_time, 1_700_000_000) // ms → s
  assert.equal(event.action_source, "website")
  assert.equal(event.event_id, "evt-123")
  assert.equal(event.event_source_url, "https://sims.example/demoform/web")

  const userData = event.user_data as Record<string, unknown>
  assert.deepEqual(userData.ph, [sha256("60123456789")])
  assert.deepEqual(userData.fn, [sha256("ada")])
  assert.deepEqual(userData.ln, [sha256("lovelace")])
  // Not hashed:
  assert.equal(userData.client_ip_address, "203.0.113.7")
  assert.equal(userData.client_user_agent, "Mozilla/5.0")
  assert.equal(userData.fbc, "fb.1.1700000000000.click-abc")
  assert.equal(userData.fbp, "fb.1.100.200")

  assert.deepEqual(event.custom_data, {
    source: "web",
    business_type: "Restaurant",
    language: "en",
  })
})

test("buildLeadEvent omits optional fields when absent", () => {
  delete process.env.LEAD_WHATSAPP_COUNTRY_CODE
  const event = buildLeadEvent(
    {
      ...baseInput,
      eventId: null,
      eventSourceUrl: null,
      name: null,
      fbp: null,
      fbclid: null,
      fbc: null,
      source: null,
      businessType: null,
      language: null,
    },
    1_700_000_000_000
  )

  assert.equal("event_id" in event, false)
  assert.equal("event_source_url" in event, false)
  assert.equal("custom_data" in event, false)
  const userData = event.user_data as Record<string, unknown>
  assert.equal("fbc" in userData, false)
  assert.equal("fbp" in userData, false)
  assert.equal("fn" in userData, false)
})
