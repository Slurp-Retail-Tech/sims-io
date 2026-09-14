import type { Queryable } from "./db.ts"

/**
 * One shared writer for `ticket_history`.
 *
 * Before this existed the same INSERT was hand-written at nine call sites, each
 * with its own column ordering, and two of them looped one round trip per
 * changed field. Taking a `Queryable` is what lets a caller pass the connection
 * of an open transaction so the history row commits atomically with the ticket
 * row it describes.
 */
export type TicketHistoryEntry = {
  field: string
  oldValue: string | null
  newValue: string | null
  /**
   * Emit SQL `NOW(3)` for `new_value` instead of binding text. Reproduces the
   * behaviour the CSAT share path relied on when it wrote its own INSERT.
   */
  newValueIsNow?: boolean
}

/** Field names the CSAT link paths write, including the legacy spelling. */
export const CSAT_SHARED_HISTORY_FIELDS: readonly string[] = [
  "csat_token_generated",
  "csat_link_shared",
  "csat_link_send_failed",
]

/**
 * Build a single multi-row INSERT for `entries`, or null when there is nothing
 * to write. Pure, so the column ordering and the NOW(3) tuple are unit-tested
 * without a database.
 */
export function buildTicketHistoryInsert(
  ticketId: string,
  entries: readonly TicketHistoryEntry[],
  actor: string
): { sql: string; values: Array<string | null> } | null {
  if (entries.length === 0) {
    return null
  }

  const tuples: string[] = []
  const values: Array<string | null> = []

  for (const entry of entries) {
    if (entry.newValueIsNow) {
      tuples.push("(?, ?, ?, NOW(3), ?)")
      values.push(ticketId, entry.field, entry.oldValue, actor)
      continue
    }
    tuples.push("(?, ?, ?, ?, ?)")
    values.push(ticketId, entry.field, entry.oldValue, entry.newValue, actor)
  }

  return {
    sql:
      `INSERT INTO ticket_history (ticket_id, field_name, old_value, new_value, changed_by)\n` +
      `VALUES ${tuples.join(", ")}`,
    values,
  }
}

/** Write `entries` as one round trip. A no-op for an empty batch. */
export async function insertTicketHistory(
  db: Queryable,
  ticketId: string,
  entries: readonly TicketHistoryEntry[],
  actor: string
): Promise<void> {
  const statement = buildTicketHistoryInsert(ticketId, entries, actor)
  if (!statement) {
    return
  }
  await db.query(statement.sql, statement.values)
}
