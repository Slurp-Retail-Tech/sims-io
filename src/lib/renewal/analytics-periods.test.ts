import assert from "node:assert/strict"
import test from "node:test"

import { periodForKey, resolvePeriod } from "./analytics-periods.ts"

test("the picker looks ahead as well as back, current month by default", () => {
  const { period, periods } = resolvePeriod(null, "2026-09-23")
  assert.equal(period.key, "2026-09")
  assert.deepEqual(periods.slice(0, 5).map((entry) => entry.key), ["2026-12", "2026-11", "2026-10", "2026-09", "2026-08"])
  // Eleven months back reaches October of last year.
  assert.equal(periods[14].key, "2025-10")
  assert.deepEqual(periods.slice(-2).map((entry) => entry.label), ["Full year 2026", "Full year 2025"])
})

test("months cross the year boundary cleanly", () => {
  const { periods } = resolvePeriod(null, "2026-11-02")
  assert.deepEqual(periods.slice(0, 3).map((entry) => entry.key), ["2027-02", "2027-01", "2026-12"])
  assert.equal(periodForKey("2027-02")!.to, "2027-02-28")
  assert.equal(periodForKey("2028-02")!.to, "2028-02-29")
})

test("an unknown key falls back to the current month", () => {
  assert.equal(resolvePeriod("2019-01", "2026-09-23").period.key, "2026-09")
  assert.equal(resolvePeriod("nonsense", "2026-09-23").period.key, "2026-09")
  assert.equal(resolvePeriod("2025", "2026-09-23").period.label, "Full year 2025")
})

test("only well-formed keys have a window", () => {
  assert.equal(periodForKey("2026-13"), null)
  assert.equal(periodForKey("26-01"), null)
  assert.deepEqual(periodForKey("2026"), { key: "2026", from: "2026-01-01", to: "2026-12-31", label: "Full year 2026" })
})
