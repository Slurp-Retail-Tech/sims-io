import assert from "node:assert/strict"
import test from "node:test"

import { validateActivityInput } from "./lead-activities.ts"

const base = {
  activityDate: "2026-06-29T10:00:00.000Z",
  remarks: null,
  callOutcome: null,
  callDirection: null,
  meetingOutcome: null,
  locationType: null,
  location: null,
}

test("Note does not require an activity date and date is nulled", () => {
  const result = validateActivityInput({
    ...base,
    activityType: "Note",
    activityDate: null,
  })
  assert.equal(result.ok, true)
  if (result.ok) {
    assert.equal(result.values.activityDate, null)
  }
})

test("non-Note types require an activity date", () => {
  const result = validateActivityInput({
    ...base,
    activityType: "Email",
    activityDate: null,
  })
  assert.equal(result.ok, false)
})

test("Call requires outcome and direction", () => {
  const missing = validateActivityInput({ ...base, activityType: "Call" })
  assert.equal(missing.ok, false)

  const ok = validateActivityInput({
    ...base,
    activityType: "Call",
    callOutcome: "Connected",
    callDirection: "Outbound",
  })
  assert.equal(ok.ok, true)
})

test("Meeting onsite requires a location; online does not and clears it", () => {
  const onsiteMissing = validateActivityInput({
    ...base,
    activityType: "Meeting",
    meetingOutcome: "Scheduled",
    locationType: "Onsite",
  })
  assert.equal(onsiteMissing.ok, false)

  const online = validateActivityInput({
    ...base,
    activityType: "Meeting",
    meetingOutcome: "Scheduled",
    locationType: "Online",
    location: "ignored",
  })
  assert.equal(online.ok, true)
  if (online.ok) {
    assert.equal(online.values.location, null)
  }
})

test("type-irrelevant fields are force-nulled", () => {
  const result = validateActivityInput({
    ...base,
    activityType: "Email",
    callOutcome: "Connected",
    meetingOutcome: "Scheduled",
  })
  assert.equal(result.ok, true)
  if (result.ok) {
    assert.equal(result.values.callOutcome, null)
    assert.equal(result.values.meetingOutcome, null)
  }
})
