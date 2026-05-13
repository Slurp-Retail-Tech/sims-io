import assert from "node:assert/strict"
import test from "node:test"

import {
  APP_TIME_ZONE,
  APP_TIME_ZONE_SQL_OFFSET,
  localSqlDate,
  localSqlDateTime,
  formatAppDateTimeToken,
  formatAppDateInput,
  getAppYear,
  localSqlHour,
  localSqlMonth,
  localSqlToday,
} from "./app-timezone.ts"

test("exports the app timezone constants", () => {
  assert.equal(APP_TIME_ZONE, "Asia/Kuala_Lumpur")
  assert.equal(APP_TIME_ZONE_SQL_OFFSET, "+08:00")
})

test("builds SQL expressions using a fixed Malaysia offset", () => {
  assert.equal(
    localSqlDate("tickets.created_at"),
    "DATE(DATE_ADD(tickets.created_at, INTERVAL 8 HOUR))"
  )
  assert.equal(
    localSqlHour("tickets.created_at"),
    "HOUR(DATE_ADD(tickets.created_at, INTERVAL 8 HOUR))"
  )
  assert.equal(
    localSqlMonth("tickets.created_at"),
    "DATE_FORMAT(DATE_ADD(tickets.created_at, INTERVAL 8 HOUR), '%Y-%m')"
  )
  assert.equal(
    localSqlToday(),
    "DATE(DATE_ADD(UTC_TIMESTAMP(), INTERVAL 8 HOUR))"
  )
})

test("shifts UTC dates into Malaysia calendar dates", () => {
  const utcLateApril = new Date("2026-04-30T16:30:00.000Z")
  const utcMidday = new Date("2026-05-13T04:15:00.000Z")

  assert.equal(localSqlDateTime(utcLateApril), "2026-05-01 00:30:00.000")
  assert.equal(localSqlDateTime(utcMidday), "2026-05-13 12:15:00.000")
  assert.equal(formatAppDateTimeToken(utcLateApril), "20260501-003000")
  assert.equal(formatAppDateInput(utcLateApril), "2026-05-01")
  assert.equal(getAppYear(new Date("2025-12-31T16:30:00.000Z")), "2026")
})
