/**
 * The rules behind the merchant's renewal link that need no database.
 *
 * Split out of `public-invoice.ts` so they can be unit-tested under
 * `node --test` without dragging in the pool, storage or the PDF renderer.
 */

import { addDays, daysBetween } from "./invoice-build.ts"
import type { InvoiceStatus } from "./invoices.ts"

/** 32 bytes base64url, exactly what `mintRenewalToken` produces. */
export function isRenewalTokenShape(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{43}$/.test(value)
}

export type Payability =
  /** Open and inside the grace window. */
  | "payable"
  | "paid"
  /** Past the grace window without payment. */
  | "lapsed"
  /** Cancelled or superseded; nothing to do here. */
  | "closed"

/**
 * Whether the merchant can still act on this invoice today.
 *
 * The grace window runs from the due date, which is the earliest expiry on the
 * invoice. A payment inside it still extends from the original expiry, so
 * paying late costs nothing but the days already lost.
 */
export function payabilityOf(
  invoice: { status: InvoiceStatus; dueDate: string | null },
  graceWindowDays: number,
  today: string
): Payability {
  if (invoice.status === "paid") {
    return "paid"
  }
  if (invoice.status === "lapsed") {
    return "lapsed"
  }
  if (invoice.status === "cancelled" || invoice.status === "superseded") {
    return "closed"
  }
  if (invoice.dueDate) {
    const lastPayableDay = addDays(invoice.dueDate, Math.max(0, graceWindowDays))
    if (daysBetween(today, lastPayableDay) < 0) {
      return "lapsed"
    }
  }
  return "payable"
}

/** The last day the link accepts payment, or null when there is no due date. */
export function graceEndsOn(dueDate: string | null, graceWindowDays: number): string | null {
  return dueDate ? addDays(dueDate, Math.max(0, graceWindowDays)) : null
}
