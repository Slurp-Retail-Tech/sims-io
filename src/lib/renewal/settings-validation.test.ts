import assert from "node:assert/strict"
import test from "node:test"

import { validateSettingsPatch } from "./settings-validation.ts"

test("an empty patch is valid and changes nothing", () => {
  assert.deepEqual(validateSettingsPatch({}), { ok: true, patch: {} })
})

test("offsets are de-duplicated and sorted furthest-first", () => {
  const result = validateSettingsPatch({ reminderOffsets: ["5", 15, 1, 5] })
  assert.deepEqual(result, { ok: true, patch: { reminderOffsets: [15, 5, 1] } })
})

test("an empty offset list is refused, because it would mean never remind", () => {
  const result = validateSettingsPatch({ reminderOffsets: [] })
  assert.equal(result.ok, false)
  assert.equal(!result.ok && result.errors[0].field, "reminderOffsets")
})

test("offsets must be whole days inside a year", () => {
  assert.equal(validateSettingsPatch({ reminderOffsets: [1.5] }).ok, false)
  assert.equal(validateSettingsPatch({ reminderOffsets: [-1] }).ok, false)
  assert.equal(validateSettingsPatch({ reminderOffsets: [400] }).ok, false)
})

test("percentages round to two decimals and stay within 0 to 100", () => {
  const result = validateSettingsPatch({ taxRatePercent: "8.125", overrideVarianceThresholdPct: 15 })
  assert.deepEqual(result, {
    ok: true,
    patch: { taxRatePercent: 8.13, overrideVarianceThresholdPct: 15 },
  })
  assert.equal(validateSettingsPatch({ taxRatePercent: 101 }).ok, false)
})

test("the send window is HH:MM and must end after it starts", () => {
  assert.deepEqual(validateSettingsPatch({ sendWindowStart: "09:00", sendWindowEnd: "18:00" }), {
    ok: true,
    patch: { sendWindowStart: "09:00:00", sendWindowEnd: "18:00:00" },
  })
  const backwards = validateSettingsPatch({ sendWindowStart: "18:00", sendWindowEnd: "09:00" })
  assert.equal(backwards.ok, false)
  assert.equal(!backwards.ok && backwards.errors[0].field, "sendWindowEnd")
  assert.equal(validateSettingsPatch({ sendWindowStart: "9am" }).ok, false)
})

test("the kill switch is a boolean, nothing looser", () => {
  assert.deepEqual(validateSettingsPatch({ dispatchEnabled: false }), {
    ok: true,
    patch: { dispatchEnabled: false },
  })
  assert.equal(validateSettingsPatch({ dispatchEnabled: "yes" }).ok, false)
})

test("a session expiry shorter than five minutes is refused", () => {
  assert.equal(validateSettingsPatch({ sessionExpiryMinutes: 2 }).ok, false)
  assert.deepEqual(validateSettingsPatch({ sessionExpiryMinutes: "1440" }), {
    ok: true,
    patch: { sessionExpiryMinutes: 1440 },
  })
})

test("optional text fields blank out to null", () => {
  assert.deepEqual(validateSettingsPatch({ respondioWhatsappChannelId: "  " }), {
    ok: true,
    patch: { respondioWhatsappChannelId: null },
  })
  assert.deepEqual(validateSettingsPatch({ bukkuDescriptionFormat: "{plan} · {outlet}" }), {
    ok: true,
    patch: { bukkuDescriptionFormat: "{plan} · {outlet}" },
  })
})

test("every error names its field, so the form can point at it", () => {
  const result = validateSettingsPatch({ graceWindowDays: "soon", maxSessionRetries: 99 })
  assert.equal(result.ok, false)
  assert.deepEqual(
    !result.ok ? result.errors.map((error) => error.field) : [],
    ["graceWindowDays", "maxSessionRetries"]
  )
})
