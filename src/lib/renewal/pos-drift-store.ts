/**
 * Database side of POS drift: raise and clear the queue entries the nightly
 * subscription sync finds, and apply "Accept POS date". The rules and the
 * wording are in `pos-drift.ts`.
 */

import getPool, { withTransaction, type Queryable } from "../db.ts"
import type { ResultSetHeader, RowDataPacket } from "mysql2/promise"

import { raiseAction, resolveUnseenActions } from "./actions-required.ts"
import { buildDriftAction, decideAcceptPosDate } from "./pos-drift.ts"
import { scopeKey } from "./readiness.ts"
import type { ValidUntilDrift } from "./subscription-sync.ts"

const DRIFT_REASON = "pos_valid_until_drift" as const

/**
 * Raise an entry for every drift in a batch and clear the ones the batch
 * examined that no longer drift.
 *
 * Called per batch because the sync walks outlets in keyset batches across
 * slices: the batch is exactly the set of outlets this pass has an opinion
 * about, and an outlet in a later batch must not be judged by this one.
 */
export async function reconcileDriftForBatch(
  examined: ReadonlyArray<{ franchiseId: string; outletId: string }>,
  drifts: readonly ValidUntilDrift[],
  db: Queryable = getPool()
): Promise<{ raised: number; resolved: number }> {
  const seen = new Set<string>()
  for (const drift of drifts) {
    const proforma = await findOpenProformaForOutlet(drift.franchiseId, drift.outletId, db)
    const action = buildDriftAction(drift, proforma)
    await raiseAction(
      {
        franchiseId: action.franchiseId,
        outletId: action.outletId,
        invoiceId: action.invoiceId,
        reason: DRIFT_REASON,
        detail: action.detail,
      },
      db
    )
    seen.add(`${drift.franchiseId}|${drift.outletId}|${DRIFT_REASON}`)
  }

  const scopes = new Set(examined.map((outlet) => scopeKey(outlet.franchiseId, outlet.outletId)))
  const resolved = await resolveUnseenActions(scopes, seen, [DRIFT_REASON], db)
  return { raised: drifts.length, resolved }
}

async function findOpenProformaForOutlet(
  franchiseId: string,
  outletId: string,
  db: Queryable
): Promise<{ invoiceId: string; invoiceNumber: string } | null> {
  const [rows] = await db.query<Array<RowDataPacket & { id: string; invoice_number: string }>>(
    `SELECT i.id, i.invoice_number
       FROM renewal_invoices i
       JOIN renewal_invoice_items t ON t.invoice_id = i.id
      WHERE i.deleted_at IS NULL
        AND i.document_type = 'proforma'
        AND i.status IN ('draft', 'issued', 'sent', 'payment_pending')
        AND i.franchise_id = ?
        AND t.outlet_id = ?
      ORDER BY i.id DESC
      LIMIT 1`,
    [franchiseId, outletId]
  )
  const row = rows[0]
  return row ? { invoiceId: String(row.id), invoiceNumber: row.invoice_number } : null
}

export type AcceptOutcome =
  | { ok: true; validUntil: string }
  | { ok: false; status: 404 | 409; message: string }

/**
 * Take the POS expiry as the SIMS expiry for the outlet a drift entry names.
 *
 * Marks the date `manual`, so the sync keeps treating it as SIMS-owned, and
 * resolves the entry against the person who accepted it. In one transaction,
 * with the subscription row locked, so two people pressing the button cannot
 * both apply it and a concurrent payment extension is not overwritten.
 */
export async function acceptPosValidUntil(
  actionId: string,
  actorUserId: string
): Promise<AcceptOutcome> {
  return withTransaction(async (connection) => {
    const [actions] = await connection.query<
      Array<RowDataPacket & { franchise_id: string; outlet_id: string | null }>
    >(
      `SELECT franchise_id, outlet_id FROM renewal_actions_required
        WHERE id = ? AND status = 'open' AND reason = ?
        FOR UPDATE`,
      [actionId, DRIFT_REASON]
    )
    const action = actions[0]
    if (!action || !action.outlet_id) {
      return { ok: false, status: 404, message: "No open drift entry here." }
    }

    const [subscriptions] = await connection.query<
      Array<RowDataPacket & { id: string; valid_until: string | null; pos_valid_until: string | null }>
    >(
      `SELECT id, valid_until, pos_valid_until FROM outlet_subscriptions
        WHERE franchise_id = ? AND outlet_id = ? AND deleted_at IS NULL
        FOR UPDATE`,
      [action.franchise_id, action.outlet_id]
    )
    const subscription = subscriptions[0]
    if (!subscription) {
      return { ok: false, status: 404, message: "The outlet's subscription no longer exists." }
    }

    const decision = decideAcceptPosDate(subscription.valid_until, subscription.pos_valid_until)
    if (!decision.ok) {
      return {
        ok: false,
        status: 409,
        message:
          decision.reason === "no_pos_date"
            ? "The POS no longer reports an expiry for this outlet."
            : "The POS date is no longer ahead of SIMS. The entry will clear on the next sync.",
      }
    }

    await connection.query<ResultSetHeader>(
      `UPDATE outlet_subscriptions
          SET valid_until = ?, valid_until_source = 'manual'
        WHERE id = ?`,
      [decision.validUntil, subscription.id]
    )
    await connection.query<ResultSetHeader>(
      `UPDATE renewal_actions_required
          SET status = 'resolved', resolved_at = NOW(3), resolved_by_user_id = ?
        WHERE id = ? AND status = 'open'`,
      [actorUserId, actionId]
    )
    return { ok: true, validUntil: decision.validUntil }
  })
}
