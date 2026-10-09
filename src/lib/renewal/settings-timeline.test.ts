import assert from "node:assert/strict"
import test from "node:test"

import { buildSettingsTimeline } from "./settings-timeline.ts"

const defaults = { readinessWindowDays: 30, reminderOffsets: [15, 5, 1], graceWindowDays: 30 }

test("the invoicing window is the furthest reminder offset", () => {
  const timeline = buildSettingsTimeline(defaults)
  assert.equal(timeline.invoiceWindowDays, 15)
  const invoicing = timeline.segments.find((segment) => segment.key === "invoicing")!
  assert.equal(invoicing.fromDay, -15)
  assert.equal(invoicing.toDay, 0)
  assert.match(invoicing.detail, /furthest reminder offset/)
})

test("segments run readiness, invoicing, grace, and meet end to end", () => {
  const timeline = buildSettingsTimeline(defaults)
  assert.deepEqual(
    timeline.segments.map((segment) => [segment.key, segment.fromDay, segment.toDay]),
    [
      ["readiness", -30, -15],
      ["invoicing", -15, 0],
      ["grace", 0, 30],
    ]
  )
  assert.equal(timeline.segments[0].fromPct, 0)
  assert.equal(timeline.segments.at(-1)!.toPct, 100)
  // Expiry sits in the middle when readiness and grace are equal.
  assert.equal(timeline.markers.find((marker) => marker.kind === "expiry")!.pct, 50)
  assert.deepEqual(timeline.notes, [])
})

test("reminders are marked furthest first, once each", () => {
  const timeline = buildSettingsTimeline({ ...defaults, reminderOffsets: [1, 15, 5, 5] })
  assert.deepEqual(
    timeline.markers.filter((marker) => marker.kind === "reminder").map((marker) => marker.label),
    ["T-15", "T-5", "T-1"]
  )
})

test("a readiness window inside the invoicing window is drawn away and explained", () => {
  const timeline = buildSettingsTimeline({ ...defaults, readinessWindowDays: 10 })
  assert.equal(timeline.segments.some((segment) => segment.key === "readiness"), false)
  assert.equal(timeline.notes.length, 1)
  assert.match(timeline.notes[0], /gives no warning/)
  // The axis starts at the invoicing window, the earliest day anything reaches.
  assert.equal(timeline.segments[0].fromPct, 0)
})

test("no grace window draws no grace segment", () => {
  const timeline = buildSettingsTimeline({ ...defaults, graceWindowDays: 0 })
  assert.equal(timeline.segments.some((segment) => segment.key === "grace"), false)
})

test("half-typed values are clamped, never thrown on", () => {
  const timeline = buildSettingsTimeline({ readinessWindowDays: Number.NaN, reminderOffsets: [-3, 2.7], graceWindowDays: -1 })
  assert.equal(timeline.invoiceWindowDays, 2)
  for (const segment of timeline.segments) {
    assert.ok(segment.fromPct >= 0 && segment.toPct <= 100)
  }
})
