import assert from "node:assert/strict"
import test from "node:test"

import {
  cancelReason,
  isInsideSendWindow,
  nextSendableAt,
  planDispatches,
  reminderTypeForNight,
  retryDelayMinutes,
} from "./dispatch-plan.ts"
import type { ResolvedRecipient } from "./pic-resolution.ts"

function recipient(overrides: Partial<ResolvedRecipient> & { contactId: string }): ResolvedRecipient {
  return {
    name: `Contact ${overrides.contactId}`,
    role: "pic",
    source: "outlet",
    usable: [],
    unusable: [],
    ...overrides,
  }
}

test("a new proforma announces itself with the first reminder, whatever the night", () => {
  assert.equal(reminderTypeForNight({ daysToExpiry: 9, offsets: [15, 5, 1], createdTonight: true }), "reminder_first")
  // Raised on the T-5 night: one message, not the first and the second.
  assert.equal(reminderTypeForNight({ daysToExpiry: 5, offsets: [15, 5, 1], createdTonight: true }), "reminder_first")
})

test("after that, reminders follow the offsets: furthest first, nearest final", () => {
  const night = (daysToExpiry: number) => reminderTypeForNight({ daysToExpiry, offsets: [1, 15, 5], createdTonight: false })
  assert.equal(night(15), "reminder_first")
  assert.equal(night(5), "reminder_second")
  assert.equal(night(1), "reminder_final")
  assert.equal(night(9), null)
  // Two offsets: first and final, no second.
  assert.equal(reminderTypeForNight({ daysToExpiry: 3, offsets: [10, 3], createdTonight: false }), "reminder_final")
})

test("every recipient gets every usable channel, PIC first", () => {
  const plan = planDispatches("reminder_first", {
    pic: recipient({
      contactId: "1",
      usable: [
        { channel: "whatsapp", address: "+60162207781" },
        { channel: "email", address: "pic@merchant.my" },
      ],
    }),
    ccs: [recipient({ contactId: "2", role: "cc", usable: [{ channel: "email", address: "cc@merchant.my" }] })],
  })
  assert.deepEqual(
    plan.map((row) => [row.recipientKey, row.channel, row.status]),
    [
      ["contact:1", "whatsapp", "queued"],
      ["contact:1", "email", "queued"],
      ["contact:2", "email", "queued"],
    ]
  )
})

test("one address never receives the same message twice", () => {
  const plan = planDispatches("reminder_second", {
    pic: recipient({ contactId: "1", usable: [{ channel: "email", address: "Owner@Merchant.my" }] }),
    ccs: [recipient({ contactId: "2", role: "cc", name: "Aisyah", usable: [{ channel: "email", address: "owner@merchant.my " }] })],
  })
  assert.equal(plan[1].status, "suppressed")
  assert.match(plan[1].statusNote ?? "", /Same address as Contact 1/)
})

test("the payer's address is not sent an email receipt; their WhatsApp receipt still goes", () => {
  const plan = planDispatches(
    "receipt",
    {
      pic: recipient({
        contactId: "1",
        usable: [
          { channel: "whatsapp", address: "+60162207781" },
          { channel: "email", address: "pic@merchant.my" },
        ],
      }),
      ccs: [recipient({ contactId: "2", role: "cc", usable: [{ channel: "email", address: "cc@merchant.my" }] })],
    },
    { payerEmail: "PIC@merchant.my" }
  )
  assert.deepEqual(
    plan.map((row) => [row.recipientKey, row.channel, row.status]),
    [
      ["contact:1", "whatsapp", "queued"],
      ["contact:1", "email", "suppressed"],
      ["contact:2", "email", "queued"],
    ]
  )
})

test("the same contact designated twice is one person", () => {
  const pic = recipient({ contactId: "1", usable: [{ channel: "email", address: "pic@merchant.my" }] })
  const plan = planDispatches("reminder_first", { pic, ccs: [{ ...pic, role: "cc" }] })
  assert.equal(plan.length, 1)
})

test("retries widen, then stop at the last gap", () => {
  assert.deepEqual([1, 2, 3, 4].map(retryDelayMinutes), [5, 30, 120, 120])
})

test("the send window is Kuala Lumpur time and may run overnight", () => {
  assert.equal(isInsideSendWindow("09:00:00", "09:00:00", "18:00:00"), true)
  assert.equal(isInsideSendWindow("18:00:00", "09:00:00", "18:00:00"), false)
  assert.equal(isInsideSendWindow("23:30:00", "22:00", "06:00"), true)
  assert.equal(isInsideSendWindow("12:00:00", "22:00", "06:00"), false)
})

test("outside the window, a reminder waits for the next opening", () => {
  // 20:00 in Kuala Lumpur is 12:00 UTC; the next 09:00 KL is 01:00 UTC tomorrow.
  const evening = new Date("2026-09-23T12:00:00.000Z")
  assert.equal(nextSendableAt(evening, "09:00:00", "18:00:00").toISOString(), "2026-09-24T01:00:00.000Z")
  // 07:00 KL (23:00 UTC the day before) opens at 09:00 KL the same morning.
  const early = new Date("2026-09-22T23:00:00.000Z")
  assert.equal(nextSendableAt(early, "09:00:00", "18:00:00").toISOString(), "2026-09-23T01:00:00.000Z")
  // Inside the window: now.
  const midday = new Date("2026-09-23T04:00:00.000Z")
  assert.equal(nextSendableAt(midday, "09:00:00", "18:00:00").toISOString(), midday.toISOString())
})

test("reminders stop once the invoice closes or the licence expires; receipts need a payment", () => {
  const today = "2026-09-23"
  assert.equal(cancelReason({ dispatchType: "reminder_second" }, { status: "sent", dueDate: "2026-09-28" }, today), null)
  assert.match(cancelReason({ dispatchType: "reminder_final" }, { status: "paid", dueDate: "2026-09-28" }, today) ?? "", /paid/)
  assert.match(cancelReason({ dispatchType: "reminder_final" }, { status: "issued", dueDate: "2026-09-22" }, today) ?? "", /expired/)
  assert.equal(cancelReason({ dispatchType: "receipt" }, { status: "paid", dueDate: "2026-09-22" }, today), null)
  assert.match(cancelReason({ dispatchType: "receipt" }, { status: "cancelled", dueDate: null }, today) ?? "", /not paid/)
})
