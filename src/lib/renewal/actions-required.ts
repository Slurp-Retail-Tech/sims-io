/**
 * The queue of things that stop a renewal being carried through.
 *
 * Every reason is a specific, actionable gap — a missing plan, nobody
 * accountable, a price waiting for sign-off — rather than a generic failure.
 * The point of the queue is that it is worked *before* the reminder window
 * closes, so an outlet does not lapse for a reason somebody could have fixed
 * in a minute.
 *
 * Entries auto-resolve. The nightly run reports what is wrong right now, and
 * anything it no longer reports is closed with a resolution recorded. That
 * keeps the queue a picture of the present rather than a log of everything
 * that has ever been wrong.
 */

import getPool, { type Queryable } from "../db.ts"
import type { ResultSetHeader, RowDataPacket } from "mysql2/promise"

/**
 * Why a subscription cannot be carried through.
 *
 * `blocking` reasons stop an invoice being raised. `informational` ones are
 * recorded and shown, but the invoice and dispatch proceed — a PIC reachable
 * on one of their two channels still gets the reminder.
 */
export const ACTION_REASONS = {
  no_plan_assigned: "blocking",
  plan_missing_term_price: "blocking",
  override_pending_approval: "blocking",
  no_renewal_pic: "blocking",
  ambiguous_renewal_pic: "blocking",
  unreachable_renewal_pic: "blocking",
  channel_unreachable: "informational",
  missing_valid_until: "blocking",
  dispatch_failed: "blocking",
  payment_amount_mismatch: "blocking",
  extension_failed: "blocking",
  pos_push_failed: "informational",
  pos_valid_until_drift: "informational",
  payer_email_failed: "blocking",
  overpayment: "blocking",
} as const

export type ActionReason = keyof typeof ACTION_REASONS

export type ActionEntry = {
  franchiseId: string
  outletId: string | null
  centralId?: string | null
  invoiceId?: string | null
  reason: ActionReason
  detail?: string | null
  daysToExpiry?: number | null
}

export type ActionRow = {
  id: string
  franchiseId: string
  outletId: string | null
  centralId: string | null
  invoiceId: string | null
  reason: ActionReason
  detail: string | null
  severity: "blocking" | "informational"
  daysToExpiry: number | null
  occurrenceCount: number
  status: "open" | "resolved" | "dismissed"
  firstDetectedAt: string
  lastDetectedAt: string
}

type Row = RowDataPacket & {
  id: string
  franchise_id: string
  outlet_id: string | null
  central_id: string | null
  invoice_id: string | null
  reason: ActionReason
  detail: string | null
  severity: "blocking" | "informational"
  days_to_expiry: number | null
  occurrence_count: number
  status: "open" | "resolved" | "dismissed"
  first_detected_at: string
  last_detected_at: string
}

export function severityOf(reason: ActionReason): "blocking" | "informational" {
  return ACTION_REASONS[reason]
}

/** True when this reason stops an invoice being raised. */
export function isBlocking(reason: ActionReason): boolean {
  return ACTION_REASONS[reason] === "blocking"
}

/**
 * Raise an entry, or touch the one already open for the same scope and reason.
 *
 * Upsert rather than insert, so a gap persisting across nightly runs stays one
 * entry with a rising occurrence count rather than becoming a pile of
 * duplicates. The unique key is on a generated column that collapses to NULL
 * once the entry is closed, so the same gap reappearing months later opens a
 * fresh entry rather than resurrecting a resolved one.
 */
export async function raiseAction(
  entry: ActionEntry,
  db: Queryable = getPool()
): Promise<void> {
  await db.query<ResultSetHeader>(
    `INSERT INTO renewal_actions_required
       (franchise_id, outlet_id, central_id, invoice_id, reason, detail,
        severity, days_to_expiry, occurrence_count, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, 'open')
     ON DUPLICATE KEY UPDATE
       detail = VALUES(detail),
       invoice_id = VALUES(invoice_id),
       days_to_expiry = VALUES(days_to_expiry),
       occurrence_count = occurrence_count + 1,
       last_detected_at = NOW(3)`,
    [
      entry.franchiseId,
      entry.outletId,
      entry.centralId ?? null,
      entry.invoiceId ?? null,
      entry.reason,
      entry.detail ?? null,
      severityOf(entry.reason),
      entry.daysToExpiry ?? null,
    ]
  )
}

/**
 * Close every open entry the current run examined and did not raise again.
 *
 * `examinedScopes` holds `franchiseId|outletId` (or `franchiseId|*` for a
 * franchise-level entry) for every scope the run actually evaluated. `seen`
 * holds `franchiseId|outletId|reason` for everything still wrong. An open
 * entry is resolved only when its scope was examined, its reason is one the
 * run evaluates, and it is not in `seen` — which is what makes fixing the
 * underlying gap enough, with no second action needed to clear the queue.
 *
 * Scoped to the exact outlets examined rather than to whole franchises: a run
 * that looked at one outlet in a franchise has no opinion about the others,
 * and must not close their entries. Restricted to `reasons` for the same
 * cause: a dispatch failure is not something the eligibility pass can vouch
 * for, so it never closes one.
 */
export async function resolveUnseenActions(
  examinedScopes: ReadonlySet<string>,
  seen: ReadonlySet<string>,
  reasons: readonly ActionReason[],
  db: Queryable = getPool()
): Promise<number> {
  if (examinedScopes.size === 0 || reasons.length === 0) {
    return 0
  }

  const franchiseIds = [
    ...new Set([...examinedScopes].map((scope) => scope.slice(0, scope.indexOf("|")))),
  ]

  const [rows] = await db.query<Row[]>(
    `SELECT id, franchise_id, outlet_id, reason
       FROM renewal_actions_required
      WHERE status = 'open'
        AND franchise_id IN (${franchiseIds.map(() => "?").join(", ")})
        AND reason IN (${reasons.map(() => "?").join(", ")})`,
    [...franchiseIds, ...reasons]
  )

  const stale = rows
    .filter((row) => {
      const scope = `${row.franchise_id}|${row.outlet_id ?? "*"}`
      return (
        examinedScopes.has(scope) && !seen.has(`${scope}|${row.reason}`)
      )
    })
    .map((row) => String(row.id))

  if (stale.length === 0) {
    return 0
  }

  const [result] = await db.query<ResultSetHeader>(
    `UPDATE renewal_actions_required
        SET status = 'resolved', resolved_at = NOW(3)
      WHERE id IN (${stale.map(() => "?").join(", ")})`,
    stale
  )

  return result.affectedRows
}

/** The key `resolveUnseenActions` matches on. */
export function actionKey(
  franchiseId: string,
  outletId: string | null,
  reason: ActionReason
): string {
  return `${franchiseId}|${outletId ?? "*"}|${reason}`
}

export async function listOpenActions(
  filters: { reason?: ActionReason; franchiseId?: string } = {},
  db: Queryable = getPool()
): Promise<ActionRow[]> {
  const conditions = ["status = 'open'"]
  const values: unknown[] = []

  if (filters.reason) {
    conditions.push("reason = ?")
    values.push(filters.reason)
  }
  if (filters.franchiseId) {
    conditions.push("franchise_id = ?")
    values.push(filters.franchiseId)
  }

  const [rows] = await db.query<Row[]>(
    `SELECT id, franchise_id, outlet_id, central_id, invoice_id, reason, detail,
            severity, days_to_expiry, occurrence_count, status,
            first_detected_at, last_detected_at
       FROM renewal_actions_required
      WHERE ${conditions.join(" AND ")}
      ORDER BY severity ASC, days_to_expiry IS NULL, days_to_expiry ASC, id ASC`,
    values
  )

  return rows.map(mapRow)
}

/** Blocking entries only, for the nav badge. */
export async function countOpenBlockingActions(
  db: Queryable = getPool()
): Promise<number> {
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT COUNT(*) AS total FROM renewal_actions_required
      WHERE status = 'open' AND severity = 'blocking'`
  )
  return Number((rows[0] as { total: number | string } | undefined)?.total ?? 0)
}

/** Which outlets are currently blocked, keyed `franchiseId|outletId`. */
export async function loadBlockedOutletKeys(
  db: Queryable = getPool()
): Promise<Set<string>> {
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT franchise_id, outlet_id FROM renewal_actions_required
      WHERE status = 'open' AND severity = 'blocking' AND outlet_id IS NOT NULL`
  )
  return new Set(
    (rows as Array<{ franchise_id: string; outlet_id: string }>).map(
      (row) => `${row.franchise_id}|${row.outlet_id}`
    )
  )
}

export async function dismissAction(
  actionId: string,
  reason: string,
  userId: string,
  db: Queryable = getPool()
): Promise<boolean> {
  const [result] = await db.query<ResultSetHeader>(
    `UPDATE renewal_actions_required
        SET status = 'dismissed', dismiss_reason = ?, resolved_at = NOW(3),
            resolved_by_user_id = ?
      WHERE id = ? AND status = 'open'`,
    [reason, userId, actionId]
  )
  return result.affectedRows > 0
}

function mapRow(row: Row): ActionRow {
  return {
    id: String(row.id),
    franchiseId: row.franchise_id,
    outletId: row.outlet_id,
    centralId: row.central_id,
    invoiceId: row.invoice_id ? String(row.invoice_id) : null,
    reason: row.reason,
    detail: row.detail,
    severity: row.severity,
    daysToExpiry: row.days_to_expiry,
    occurrenceCount: Number(row.occurrence_count),
    status: row.status,
    firstDetectedAt: row.first_detected_at,
    lastDetectedAt: row.last_detected_at,
  }
}
