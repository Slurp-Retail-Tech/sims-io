import assert from "node:assert/strict"
import test from "node:test"

import {
  cancelSalesAppointment,
  parseParticipantEmails,
  updateSalesAppointmentFromActivity,
} from "./sales-appointments.ts"

function withCalendarDisabled() {
  const original = process.env.GOOGLE_CALENDAR_ENABLED
  process.env.GOOGLE_CALENDAR_ENABLED = "false"
  return () => {
    if (original === undefined) delete process.env.GOOGLE_CALENDAR_ENABLED
    else process.env.GOOGLE_CALENDAR_ENABLED = original
  }
}

test("parseParticipantEmails trims, lowercases, dedupes, validates, and caps", () => {
  assert.deepEqual(
    parseParticipantEmails(" Customer@Example.com ,not-an-email, customer@example.com, partner@example.com "),
    ["customer@example.com", "partner@example.com"]
  )
  assert.deepEqual(parseParticipantEmails(["a@b.co", "A@B.CO"]), ["a@b.co"])
  assert.deepEqual(parseParticipantEmails(null), [])
  assert.deepEqual(parseParticipantEmails(42), [])
  const many = Array.from({ length: 15 }, (_, i) => `user${i}@example.com`).join(",")
  assert.equal(parseParticipantEmails(many).length, 10)
})

test("cancelSalesAppointment skips non-Pending appointments without touching the calendar", async () => {
  const restore = withCalendarDisabled()
  const queries: string[] = []
  const pool = {
    query: async (sql: string) => {
      queries.push(sql)
      if (sql.includes("UPDATE sales_appointments")) {
        return [{ affectedRows: 0 }, []]
      }
      // resolveSkipReason SELECT — the row exists, so it is not_pending.
      return [[{ id: 7 }], []]
    },
  } as never

  try {
    const result = await cancelSalesAppointment(pool, 7, {
      canceledByUserId: "1",
      reason: "Meeting activity deleted",
    })
    assert.deepEqual(result, { status: "skipped", reason: "not_pending" })
    // Guarded UPDATE + skip-reason SELECT only; no calendar-row reload.
    assert.equal(queries.length, 2)
  } finally {
    restore()
  }
})

test("cancelSalesAppointment reports not_found for missing appointments", async () => {
  const restore = withCalendarDisabled()
  const pool = {
    query: async (sql: string) => {
      if (sql.includes("UPDATE sales_appointments")) {
        return [{ affectedRows: 0 }, []]
      }
      return [[], []]
    },
  } as never

  try {
    const result = await cancelSalesAppointment(pool, 999, {
      canceledByUserId: "1",
      reason: "Meeting canceled from lead activity",
    })
    assert.deepEqual(result, { status: "skipped", reason: "not_found" })
  } finally {
    restore()
  }
})

test("updateSalesAppointmentFromActivity updates Pending appointments and re-syncs", async () => {
  const restore = withCalendarDisabled()
  const updates: unknown[][] = []
  const pool = {
    query: async (sql: string, params: unknown[]) => {
      if (sql.includes("UPDATE sales_appointments")) {
        updates.push(params)
        return [{ affectedRows: 1 }, []]
      }
      // syncSalesAppointmentById row reload; calendar is disabled so the
      // sync itself short-circuits after mapping.
      return [
        [
          {
            id: 7,
            customer_name: "Amir",
            business_name: "Acme Cafe",
            business_type: "F&B",
            business_location: "Bangsar",
            meeting_location: "Acme Cafe, Jalan Telawi",
            google_maps_uri: null,
            participant_emails: null,
            google_meet_link: null,
            appointment_type: "Physical",
            scheduled_at: "2026-07-20 02:00:00.000",
            status: "Pending",
            cancel_reason: null,
            completion_note: null,
            google_calendar_id: null,
            google_event_id: null,
            created_by_name: "Hafiz",
            created_by_email: "hafiz@getslurp.com",
          },
        ],
        [],
      ]
    },
  } as never

  try {
    const result = await updateSalesAppointmentFromActivity(pool, 7, {
      scheduledAt: new Date("2026-07-21T03:00:00.000Z"),
      appointmentType: "Physical",
      meetingLocation: "Acme Cafe, Jalan Telawi",
      googlePlaceId: "place-123",
      googleMapsUri: "https://maps.google.com/?cid=1",
      locationLat: 3.13192,
      locationLng: 101.6841,
    })
    assert.deepEqual(result, {
      status: "updated",
      calendarSync: { status: "disabled" },
    })
    assert.equal(updates.length, 1)
    // Physical keeps location/place fields as provided.
    assert.equal(updates[0][2], "Acme Cafe, Jalan Telawi")
    assert.equal(updates[0][3], "place-123")
  } finally {
    restore()
  }
})

test("updateSalesAppointmentFromActivity nulls location and place fields for Online", async () => {
  const restore = withCalendarDisabled()
  const updates: unknown[][] = []
  const pool = {
    query: async (sql: string, params: unknown[]) => {
      if (sql.includes("UPDATE sales_appointments")) {
        updates.push(params)
        return [{ affectedRows: 1 }, []]
      }
      return [[], []]
    },
  } as never

  try {
    await updateSalesAppointmentFromActivity(pool, 7, {
      scheduledAt: new Date("2026-07-21T03:00:00.000Z"),
      appointmentType: "Online",
      meetingLocation: "should be dropped",
      googlePlaceId: "place-123",
      googleMapsUri: "https://maps.google.com/?cid=1",
      locationLat: 3.13192,
      locationLng: 101.6841,
    })
    assert.equal(updates.length, 1)
    // [scheduledAt, type, meeting_location, place_id, maps_uri, lat, lng, isPhysical, id]
    assert.equal(updates[0][1], "Online")
    assert.equal(updates[0][2], null)
    assert.equal(updates[0][3], null)
    assert.equal(updates[0][4], null)
    assert.equal(updates[0][5], null)
    assert.equal(updates[0][6], null)
  } finally {
    restore()
  }
})
