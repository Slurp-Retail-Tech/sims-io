/**
 * Who gets which renewal message, on which channel, and when.
 *
 * Every decision the dispatch pipeline makes that does not need the network
 * or the database lives here:
 *
 *  - **Which reminder tonight.** A new proforma gets `reminder_first` the
 *    night it is raised, whichever night that is: since 4.27.0 an outlet can
 *    be invoiced on any night inside the window, and the merchant needs to
 *    hear about it. After that, a reminder goes out only on the nights that
 *    land on an offset: the furthest is the first, the nearest the final,
 *    anything between the second.
 *  - **Fan-out.** One message per recipient per usable channel: the renewal
 *    PIC and every CC, on each channel they have enabled with an address.
 *  - **No duplicates to one person.** Respond.io resolves an address to one
 *    contact, so two rows for the same address would reach the same person
 *    twice. The second is recorded as suppressed. On a receipt, the address
 *    the payer's documents already went to is suppressed on email too
 *    (PRD 4.15, AC23); their WhatsApp receipt is unaffected.
 *  - **When.** Reminders wait for the send window. Receipts do not: the
 *    merchant has just paid and is waiting for them.
 *  - **Retry.** Three attempts with widening gaps, then the row fails and the
 *    invoice enters Actions Required.
 *
 * Pure and runtime-free so it is unit-tested.
 */

import type { Channel, RecipientRole, ResolvedRecipient } from "./pic-resolution.ts"

export type DispatchType = "reminder_first" | "reminder_second" | "reminder_final" | "receipt"

export const REMINDER_TYPES: readonly DispatchType[] = ["reminder_first", "reminder_second", "reminder_final"]

export type PlannedDispatch = {
  dispatchType: DispatchType
  channel: Channel
  recipientKey: string
  contactId: string
  recipientRole: RecipientRole
  recipientName: string
  /** The identifier value: an E.164 number or an email address. */
  address: string
  status: "queued" | "suppressed"
  statusNote: string | null
}

/** Attempts before a row is given up on and raised to Actions Required. */
export const MAX_DISPATCH_ATTEMPTS = 3

/**
 * The reminder, if any, an invoice gets tonight.
 *
 * `createdTonight` wins: a proforma raised tonight announces itself with the
 * first reminder even when tonight is also an offset night, so the merchant
 * never receives two messages on the night an invoice appears.
 */
export function reminderTypeForNight(input: {
  daysToExpiry: number
  offsets: readonly number[]
  createdTonight: boolean
}): DispatchType | null {
  if (input.createdTonight) {
    return "reminder_first"
  }
  const offsets = [...new Set(input.offsets)].sort((a, b) => b - a)
  const index = offsets.indexOf(input.daysToExpiry)
  if (index === -1) {
    return null
  }
  if (index === 0) {
    return "reminder_first"
  }
  return index === offsets.length - 1 ? "reminder_final" : "reminder_second"
}

/**
 * One row per recipient per usable channel, PIC first.
 *
 * `payerEmail`, on a receipt, is the address the payer documents were
 * emailed to; an email receipt to the same address is suppressed.
 */
export function planDispatches(
  dispatchType: DispatchType,
  recipients: { pic: ResolvedRecipient; ccs: readonly ResolvedRecipient[] },
  options: { payerEmail?: string | null } = {}
): PlannedDispatch[] {
  const planned: PlannedDispatch[] = []
  const seenKeys = new Set<string>()
  const firstByAddress = new Map<string, string>()
  const payerEmail = dispatchType === "receipt" ? normaliseAddress("email", options.payerEmail ?? null) : null

  for (const recipient of [recipients.pic, ...recipients.ccs]) {
    for (const usable of recipient.usable) {
      const recipientKey = `contact:${recipient.contactId}`
      // The same contact designated twice (PIC at one scope, CC at another)
      // is still one person on one channel.
      const slot = `${recipientKey}|${usable.channel}`
      if (seenKeys.has(slot)) {
        continue
      }
      seenKeys.add(slot)

      const addressKey = `${usable.channel}|${normaliseAddress(usable.channel, usable.address)}`
      let status: PlannedDispatch["status"] = "queued"
      let statusNote: string | null = null
      if (payerEmail && usable.channel === "email" && normaliseAddress("email", usable.address) === payerEmail) {
        status = "suppressed"
        statusNote = "The payer's documents were already emailed to this address."
      } else if (firstByAddress.has(addressKey)) {
        status = "suppressed"
        statusNote = `Same address as ${firstByAddress.get(addressKey)}, who is already sent this message.`
      } else {
        firstByAddress.set(addressKey, recipient.name)
      }

      planned.push({
        dispatchType,
        channel: usable.channel,
        recipientKey,
        contactId: recipient.contactId,
        recipientRole: recipient.role,
        recipientName: recipient.name,
        address: usable.address,
        status,
        statusNote,
      })
    }
  }
  return planned
}

/** Minutes before the next attempt, after `attempts` have failed. */
export function retryDelayMinutes(attempts: number): number {
  const delays = [5, 30, 120]
  return delays[Math.min(Math.max(attempts, 1), delays.length) - 1]
}

/**
 * Whether a send window (`HH:MM[:SS]`, Kuala Lumpur time) is open at a local
 * time. A window whose end is before its start runs overnight.
 */
export function isInsideSendWindow(localTime: string, start: string, end: string): boolean {
  const now = toSeconds(localTime)
  const from = toSeconds(start)
  const to = toSeconds(end)
  if (from === to) {
    return true
  }
  return from < to ? now >= from && now < to : now >= from || now < to
}

/** Kuala Lumpur has no daylight saving: a fixed offset is exact. */
const APP_ZONE_OFFSET_MINUTES = 8 * 60

/**
 * The next moment a reminder may be sent: now if the window is open,
 * otherwise the window's next opening, as a UTC instant.
 */
export function nextSendableAt(nowUtc: Date, start: string, end: string): Date {
  const local = new Date(nowUtc.getTime() + APP_ZONE_OFFSET_MINUTES * 60_000)
  const localTime = local.toISOString().slice(11, 19)
  if (isInsideSendWindow(localTime, start, end)) {
    return nowUtc
  }
  const startSeconds = toSeconds(start)
  const localMidnight = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate())
  let opening = localMidnight + startSeconds * 1000
  if (opening <= local.getTime()) {
    opening += 24 * 60 * 60 * 1000
  }
  return new Date(opening - APP_ZONE_OFFSET_MINUTES * 60_000)
}

/**
 * Why a queued row must not be sent after all, or null to send it.
 *
 * Checked at send time, not enqueue time: a reminder queued last night is
 * pointless once the invoice is paid, voided or past expiry, and a receipt is
 * only ever for a paid invoice.
 */
export function cancelReason(
  row: { dispatchType: DispatchType },
  invoice: { status: string; dueDate: string | null },
  today: string
): string | null {
  if (row.dispatchType === "receipt") {
    return invoice.status === "paid" ? null : `The invoice is ${invoice.status}, not paid.`
  }
  if (!["draft", "issued", "sent", "payment_pending"].includes(invoice.status)) {
    return `The invoice is ${invoice.status}; reminders stop.`
  }
  if (invoice.dueDate && invoice.dueDate < today) {
    return "The licence has already expired; the cadence ends at expiry."
  }
  return null
}

function normaliseAddress(channel: Channel, address: string | null): string | null {
  if (!address) {
    return null
  }
  return channel === "email" ? address.trim().toLowerCase() : address.replace(/[^\d+]/g, "")
}

function toSeconds(time: string): number {
  const [hours = "0", minutes = "0", seconds = "0"] = time.split(":")
  return Number(hours) * 3600 + Number(minutes) * 60 + Number(seconds)
}
