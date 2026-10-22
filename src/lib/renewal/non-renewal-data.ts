/**
 * Recording why outlets did not renew, and reading it back.
 *
 * A reason is stored against the outlet and the expiry it was due to renew
 * from (`renewal_non_renewals`), the subscription is marked non_renewed with
 * the reason's label, any Actions Required entry asking for the reason is
 * resolved, and an open document billing exactly these outlets is voided so
 * no reminder chases a merchant who has said no.
 */

import getPool, { type Queryable } from "../db.ts"
import type { ResultSetHeader, RowDataPacket } from "mysql2/promise"

import { voidInvoice } from "./invoice-actions.ts"
import { findOpenProformaForOutlets, loadInvoiceItems, recordEvent } from "./invoices.ts"
import { nonRenewalLabel, validateNonRenewal } from "./non-renewal.ts"
import type { NonRenewalReason } from "./non-renewal.ts"

export const REASON_MISSING_ACTION = "non_renewal_reason_missing"

export type NonRenewalRecord = {
  reason: NonRenewalReason
  label: string
  note: string | null
  recordedAt: string
  recordedByUserId: string | null
}

export type RecordOutcome =
  | { ok: true; outlets: number; voidedInvoiceNumber: string | null }
  | { ok: false; status: number; message: string }

/** `franchise|outlet|YYYY-MM-DD` → the reason recorded for that cycle. */
export async function loadNonRenewals(
  franchiseIds: readonly string[],
  db: Queryable = getPool()
): Promise<Map<string, NonRenewalRecord>> {
  if (franchiseIds.length === 0) {
    return new Map()
  }
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT franchise_id, outlet_id, cycle_valid_until, reason, note, recorded_at, recorded_by_user_id
       FROM renewal_non_renewals
      WHERE franchise_id IN (${franchiseIds.map(() => "?").join(", ")})`,
    [...franchiseIds]
  )
  return new Map(
    rows.map((row) => [
      nonRenewalKey(String(row.franchise_id), String(row.outlet_id), String(row.cycle_valid_until).slice(0, 10)),
      {
        reason: row.reason as NonRenewalReason,
        label: nonRenewalLabel(String(row.reason)),
        note: row.note === null ? null : String(row.note),
        recordedAt: String(row.recorded_at),
        recordedByUserId: row.recorded_by_user_id === null ? null : String(row.recorded_by_user_id),
      },
    ])
  )
}

export function nonRenewalKey(franchiseId: string, outletId: string, validUntilDate: string): string {
  return `${franchiseId}|${outletId}|${validUntilDate}`
}

/**
 * Record (or correct) the reason for outlets of one franchise.
 *
 * From an invoice page, `invoiceId` names the document and every outlet on
 * it is recorded; it is voided if still open. From the Renewal List, an
 * outlet whose open document also bills other outlets is refused: voiding it
 * would stop those renewals too, so the reason is recorded from the invoice.
 */
export async function recordNonRenewal(
  input: {
    franchiseId: string
    outletIds: readonly string[]
    invoiceId: string | null
    reason: NonRenewalReason
    note: string | null
    actorUserId: string
  },
  db: Queryable = getPool()
): Promise<RecordOutcome> {
  const note = input.note?.trim() || null
  const invalid = validateNonRenewal(input.reason, note)
  if (invalid) {
    return { ok: false, status: 400, message: invalid }
  }

  let outletIds = [...new Set(input.outletIds)]
  if (input.invoiceId) {
    const items = await loadInvoiceItems(input.invoiceId, db)
    if (items.length === 0) {
      return { ok: false, status: 404, message: "Invoice not found." }
    }
    outletIds = items.map((item) => item.outletId)
  }
  if (outletIds.length === 0) {
    return { ok: false, status: 400, message: "Choose at least one outlet." }
  }

  const [subscriptionRows] = await db.query<RowDataPacket[]>(
    `SELECT id, outlet_id, valid_until_date FROM outlet_subscriptions
      WHERE franchise_id = ? AND deleted_at IS NULL AND outlet_id IN (${outletIds.map(() => "?").join(", ")})`,
    [input.franchiseId, ...outletIds]
  )
  const subscriptions = subscriptionRows as Array<{ id: string; outlet_id: string; valid_until_date: string | null }>
  if (subscriptions.length !== outletIds.length) {
    return { ok: false, status: 404, message: "One of those outlets is not a subscription under this franchise." }
  }
  const undated = subscriptions.find((row) => !row.valid_until_date)
  if (undated) {
    return { ok: false, status: 400, message: `Outlet ${undated.outlet_id} has no expiry date to record a non-renewal against.` }
  }

  // The open document for these outlets, at their current expiry.
  const expiries = [...new Set(subscriptions.map((row) => String(row.valid_until_date).slice(0, 10)))]
  const open =
    input.invoiceId
      ? { id: input.invoiceId }
      : expiries.length === 1
        ? await findOpenProformaForOutlets(input.franchiseId, outletIds, expiries[0], db)
        : null
  let voidId: string | null = null
  if (open) {
    const items = await loadInvoiceItems(open.id, db)
    const onDocument = new Set(items.map((item) => item.outletId))
    const others = [...onDocument].filter((outletId) => !outletIds.includes(outletId))
    if (others.length > 0) {
      return {
        ok: false,
        status: 409,
        message: "This outlet is on a grouped document with other outlets. Record the reason from that invoice's page.",
      }
    }
    voidId = open.id
  }

  for (const row of subscriptions) {
    const cycle = String(row.valid_until_date).slice(0, 10)
    await db.query<ResultSetHeader>(
      `INSERT INTO renewal_non_renewals
         (franchise_id, outlet_id, cycle_valid_until, invoice_id, reason, note, recorded_by_user_id)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE invoice_id = COALESCE(VALUES(invoice_id), invoice_id), reason = VALUES(reason),
                               note = VALUES(note), recorded_by_user_id = VALUES(recorded_by_user_id)`,
      [input.franchiseId, row.outlet_id, cycle, voidId, input.reason, note, input.actorUserId]
    )
    await db.query<ResultSetHeader>(
      `UPDATE outlet_subscriptions SET renewal_state = 'non_renewed', renewal_state_reason = ? WHERE id = ?`,
      [nonRenewalLabel(input.reason), row.id]
    )
  }
  await db.query<ResultSetHeader>(
    `UPDATE renewal_actions_required
        SET status = 'resolved', resolved_at = NOW(3), resolved_by_user_id = ?
      WHERE status = 'open' AND reason = ? AND franchise_id = ?
        AND outlet_id IN (${outletIds.map(() => "?").join(", ")})`,
    [input.actorUserId, REASON_MISSING_ACTION, input.franchiseId, ...outletIds]
  )

  let voidedInvoiceNumber: string | null = null
  if (voidId) {
    await recordEvent(db, voidId, "non_renewal_recorded", input.actorUserId, {
      reason: input.reason,
      note,
      outlets: outletIds.length,
    })
    // An invoice already lapsed or cancelled refuses the void, which is fine:
    // there is nothing left to stop chasing.
    const voided = await voidInvoice(voidId, `Not renewing: ${nonRenewalLabel(input.reason)}${note ? ` (${note})` : ""}`, input.actorUserId, db)
    if (voided.ok) {
      const [numberRows] = await db.query<RowDataPacket[]>(`SELECT invoice_number FROM renewal_invoices WHERE id = ?`, [voidId])
      voidedInvoiceNumber = (numberRows[0] as { invoice_number?: string } | undefined)?.invoice_number ?? null
    }
  }

  return { ok: true, outlets: outletIds.length, voidedInvoiceNumber }
}

/** Remove a reason recorded against the wrong outlet. The state stays as the dates make it. */
export async function clearNonRenewal(
  franchiseId: string,
  outletId: string,
  db: Queryable = getPool()
): Promise<boolean> {
  const [result] = await db.query<ResultSetHeader>(
    `DELETE n FROM renewal_non_renewals n
       JOIN outlet_subscriptions s
         ON s.franchise_id = n.franchise_id AND s.outlet_id = n.outlet_id AND s.deleted_at IS NULL
      WHERE n.franchise_id = ? AND n.outlet_id = ? AND n.cycle_valid_until = s.valid_until_date`,
    [franchiseId, outletId]
  )
  return result.affectedRows > 0
}
