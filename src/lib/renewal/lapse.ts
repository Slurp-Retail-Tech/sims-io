/**
 * Close proformas nobody paid by the end of the grace window.
 *
 * The merchant's page has always computed "lapsed" from dates, but the row
 * stayed `issued` or `sent`, so the Invoices list showed it as open forever
 * and the funnel counted it as outstanding. The nightly cycle now moves it to
 * `lapsed`, records the transition on the timeline, and marks the outlets it
 * billed `non_renewed`.
 *
 * An invoice with an open payment session is left alone. A merchant who paid
 * on the last day of grace, with the callback lost, is found by the hourly
 * reconcile sweep through that open session; superseding it here would hide
 * the payment. The session expires or settles within a day, and the next
 * night lapses the invoice if it is still unpaid.
 */

import getPool, { type Queryable } from "../db.ts"
import type { ResultSetHeader, RowDataPacket } from "mysql2/promise"

import { recordEvent } from "./invoices.ts"
import { lapsedIfDueBefore } from "./public-invoice-rules.ts"

const OPEN_STATUSES = ["draft", "issued", "sent", "payment_pending"] as const

/** Returns how many invoices were lapsed. */
export async function sweepLapsedProformas(
  today: string,
  graceWindowDays: number,
  db: Queryable = getPool()
): Promise<number> {
  const cutoff = lapsedIfDueBefore(today, graceWindowDays)
  const [rows] = await db.query<Array<RowDataPacket & { id: string; invoice_number: string; due_date: string }>>(
    `SELECT i.id, i.invoice_number, DATE_FORMAT(i.due_date, '%Y-%m-%d') AS due_date
       FROM renewal_invoices i
      WHERE i.deleted_at IS NULL
        AND i.document_type = 'proforma'
        AND i.status IN (?)
        AND i.due_date < ?
        AND NOT EXISTS (
          SELECT 1 FROM renewal_payment_sessions s
           WHERE s.invoice_id = i.id AND s.status IN ('created', 'payment_pending')
        )`,
    [OPEN_STATUSES, cutoff]
  )

  let lapsed = 0
  for (const row of rows) {
    // Conditional on the same facts the select saw: a payment confirmed or a
    // session opened in between wins, and this invoice is skipped tonight.
    const [result] = await db.query<ResultSetHeader>(
      `UPDATE renewal_invoices i
          SET i.status = 'lapsed'
        WHERE i.id = ?
          AND i.status IN (?)
          AND NOT EXISTS (
            SELECT 1 FROM renewal_payment_sessions s
             WHERE s.invoice_id = i.id AND s.status IN ('created', 'payment_pending')
          )`,
      [row.id, OPEN_STATUSES]
    )
    if (result.affectedRows !== 1) {
      continue
    }
    lapsed += 1
    await recordEvent(db, row.id, "status_lapsed", null, {
      reason: `Unpaid ${graceWindowDays} days after the due date (${row.due_date}).`,
    })

    // Only outlets still on the expiry this invoice would have renewed: one
    // renewed some other way since has moved on and is not non-renewed.
    await db.query(
      `UPDATE outlet_subscriptions s
         JOIN renewal_invoice_items t ON t.outlet_subscription_id = s.id
          SET s.renewal_state = 'non_renewed',
              s.renewal_state_reason = ?
        WHERE t.invoice_id = ?
          AND s.renewal_state <> 'renewed'
          AND (t.previous_valid_until IS NULL OR DATE(t.previous_valid_until) = s.valid_until_date)`,
      [`${row.invoice_number} lapsed unpaid`, row.id]
    )
  }
  return lapsed
}
