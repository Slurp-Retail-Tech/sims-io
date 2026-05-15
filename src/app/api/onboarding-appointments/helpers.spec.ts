import assert from "node:assert/strict"
import test from "node:test"

import {
  canEditOnboardingAppointment,
  getDefaultScheduledEndAt,
  validateScheduledRange,
  type OnboardingAppointmentAccessUser,
} from "../../../lib/onboarding-appointment-access.ts"
import { validateApprovalAssignee } from "../../../lib/onboarding-appointment-review.ts"

test("approval requires an assigned MS PIC", () => {
  assert.deepEqual(validateApprovalAssignee(null), {
    ok: false,
    error: "MS PIC is required before approving an onboarding appointment.",
  })
})

test("approval accepts an active Merchant Success assignee", () => {
  assert.deepEqual(
    validateApprovalAssignee({
      id: "7",
      department: "Merchant Success",
      status: "active",
    }),
    { ok: true, assigneeId: "7" }
  )
})

test("approval rejects inactive or non-Merchant Success assignees", () => {
  assert.deepEqual(
    validateApprovalAssignee({
      id: "8",
      department: "Sales",
      status: "active",
    }),
    {
      ok: false,
      error: "Assignee must be an active Merchant Success user.",
    }
  )

  assert.deepEqual(
    validateApprovalAssignee({
      id: "9",
      department: "Merchant Success",
      status: "inactive",
    }),
    {
      ok: false,
      error: "Assignee must be an active Merchant Success user.",
    }
  )
})

test("defaults appointment end time to 3 hours after the start", () => {
  const start = new Date("2026-05-14T03:00:00.000Z")

  assert.equal(
    getDefaultScheduledEndAt(start).toISOString(),
    "2026-05-14T06:00:00.000Z"
  )
})

test("schedule range validation requires a valid end after the start", () => {
  const start = new Date("2026-05-14T03:00:00.000Z")

  assert.deepEqual(validateScheduledRange(start, "2026-05-14T06:00:00.000Z"), {
    ok: true,
    scheduledEndAt: new Date("2026-05-14T06:00:00.000Z"),
  })
  assert.deepEqual(validateScheduledRange(start, undefined), {
    ok: false,
    error: "End time is required.",
  })
  assert.deepEqual(validateScheduledRange(start, "not-a-date"), {
    ok: false,
    error: "Invalid end time.",
  })
  assert.deepEqual(validateScheduledRange(start, "2026-05-14T03:00:00.000Z"), {
    ok: false,
    error: "End time must be after the start time.",
  })
})

test("appointment edit permissions include admins, submitter, and assigned MS PIC", () => {
  const appointment = {
    created_by_user_id: "10",
    assigned_ms_user_id: "20",
  }
  const user = (
    overrides: Partial<OnboardingAppointmentAccessUser>
  ): OnboardingAppointmentAccessUser => ({
    id: "99",
    role: "User",
    department: "Operations",
    ...overrides,
  })

  assert.equal(
    canEditOnboardingAppointment(user({ role: "Super Admin" }), appointment),
    true
  )
  assert.equal(
    canEditOnboardingAppointment(
      user({ role: "Admin", department: "Merchant Success" }),
      appointment
    ),
    true
  )
  assert.equal(
    canEditOnboardingAppointment(
      user({ role: "Admin", department: "Sales & Marketing" }),
      appointment
    ),
    true
  )
  assert.equal(canEditOnboardingAppointment(user({ id: "10" }), appointment), true)
  assert.equal(canEditOnboardingAppointment(user({ id: "20" }), appointment), true)
  assert.equal(
    canEditOnboardingAppointment(
      user({ role: "Admin", department: "Renewal & Retention" }),
      appointment
    ),
    false
  )
  assert.equal(canEditOnboardingAppointment(user({ id: "30" }), appointment), false)
})
