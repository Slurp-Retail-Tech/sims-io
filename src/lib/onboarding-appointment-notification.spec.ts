import assert from "node:assert/strict"
import test from "node:test"

import {
  buildOnboardingAppointmentEmail,
  resolveOnboardingSubmissionRecipients,
  sendOnboardingAppointmentNotification,
  type OnboardingNotificationAppointment,
} from "./onboarding-appointment-notification.ts"

const appointment: OnboardingNotificationAppointment = {
  id: "42",
  outletName: "KLCC Outlet",
  installationType: "On-site",
  scheduledAt: "2026-05-14 10:30:00.000",
  scheduledEndAt: "2026-05-14 13:30:00.000",
  paymentStatus: "Paid",
  status: "Pending",
  locationName: "Suria KLCC",
  locationAddress: "Kuala Lumpur City Centre, 50088 Kuala Lumpur",
  googleMapsUri: "https://maps.google.com/?cid=123",
  createdByName: "Aina",
  createdByEmail: "aina@example.com",
  assignedMsUserName: "Mei",
  assignedMsUserEmail: "mei@example.com",
  decisionByName: "Ravi",
  decisionByEmail: "ravi@example.com",
  decisionReason: "Ready for install",
}

test("builds onboarding submission email with appointment details", () => {
  const email = buildOnboardingAppointmentEmail("submitted", appointment)

  assert.equal(email.subject, "Onboarding Submitted - KLCC Outlet")
  assert.match(email.text, /Outlet: KLCC Outlet/)
  assert.match(email.text, /Scheduled: 14 may 2026, 6:30 pm - 9:30 pm/)
  assert.match(email.text, /Installation: On-site/)
  assert.match(email.text, /Payment: Paid/)
  assert.match(email.text, /Submitter: Aina <aina@example.com>/)
  assert.match(email.text, /Assigned MS PIC: Mei <mei@example.com>/)
  assert.match(email.html, /Suria KLCC/)
  assert.match(email.html, /https:\/\/maps\.google\.com\/\?cid=123/)
})

test("resolves Merchant Success admin recipients before Super Admin fallback", () => {
  const recipients = resolveOnboardingSubmissionRecipients([
    {
      email: "admin@getslurp.com",
      department: "Merchant Success",
      role: "Admin",
      status: "active",
    },
    {
      email: "super@getslurp.com",
      department: "Operations",
      role: "Super Admin",
      status: "active",
    },
  ])

  assert.deepEqual(recipients, ["admin@getslurp.com"])
})

test("falls back to active Super Admin recipients when there are no Merchant Success admins", () => {
  const recipients = resolveOnboardingSubmissionRecipients([
    {
      email: "super@getslurp.com",
      department: "Operations",
      role: "Super Admin",
      status: "active",
    },
    {
      email: "inactive-admin@getslurp.com",
      department: "Merchant Success",
      role: "Admin",
      status: "inactive",
    },
  ])

  assert.deepEqual(recipients, ["super@getslurp.com"])
})

test("skips submission notification when no recipients are available", async () => {
  const result = await sendOnboardingAppointmentNotification({
    type: "submitted",
    appointment,
    recipients: [],
    sendMail: async () => {
      throw new Error("sendMail should not be called")
    },
  })

  assert.deepEqual(result, { sent: false, reason: "no-recipients" })
})
