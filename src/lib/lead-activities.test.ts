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
  googlePlaceId: null,
  googleMapsUri: null,
  locationLat: null,
  locationLng: null,
  dealId: null,
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

test("dealId passes through; empty string normalizes to null", () => {
  const linked = validateActivityInput({ ...base, activityType: "Note", dealId: "42" })
  assert.equal(linked.ok, true)
  if (linked.ok) {
    assert.equal(linked.values.dealId, "42")
  }

  const empty = validateActivityInput({ ...base, activityType: "Note", dealId: "" })
  assert.equal(empty.ok, true)
  if (empty.ok) {
    assert.equal(empty.values.dealId, null)
  }
})

test("Meeting onsite keeps place fields only when a place id is present", () => {
  const withPlace = validateActivityInput({
    ...base,
    activityType: "Meeting",
    meetingOutcome: "Scheduled",
    locationType: "Onsite",
    location: "Acme Cafe, Jalan Telawi",
    googlePlaceId: "place-123",
    googleMapsUri: "https://maps.google.com/?cid=1",
    locationLat: "3.1319200",
    locationLng: "101.6841000",
  })
  assert.equal(withPlace.ok, true)
  if (withPlace.ok) {
    assert.equal(withPlace.values.googlePlaceId, "place-123")
    assert.equal(withPlace.values.googleMapsUri, "https://maps.google.com/?cid=1")
    assert.equal(withPlace.values.locationLat, 3.13192)
    assert.equal(withPlace.values.locationLng, 101.6841)
  }

  const freeText = validateActivityInput({
    ...base,
    activityType: "Meeting",
    meetingOutcome: "Scheduled",
    locationType: "Onsite",
    location: "Somewhere typed by hand",
    googleMapsUri: "https://maps.google.com/?cid=stale",
    locationLat: "3.1",
    locationLng: "101.6",
  })
  assert.equal(freeText.ok, true)
  if (freeText.ok) {
    assert.equal(freeText.values.googlePlaceId, null)
    assert.equal(freeText.values.googleMapsUri, null)
    assert.equal(freeText.values.locationLat, null)
    assert.equal(freeText.values.locationLng, null)
  }

  const online = validateActivityInput({
    ...base,
    activityType: "Meeting",
    meetingOutcome: "Scheduled",
    locationType: "Online",
    googlePlaceId: "place-123",
  })
  assert.equal(online.ok, true)
  if (online.ok) {
    assert.equal(online.values.googlePlaceId, null)
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
