/**
 * Resume cursor for the ClickUp status sync.
 *
 * Pure and runtime-free so it can be unit-tested under `node --test`. The
 * batched SELECT that consumes it lives in `clickup-ticket-sync.ts`.
 */
export type ClickUpSyncCursor = {
  /** Exclusive lower bound; null starts from the beginning. */
  afterTicketId: string | null
}

export const INITIAL_CLICKUP_SYNC_CURSOR: ClickUpSyncCursor = {
  afterTicketId: null,
}

/**
 * Ticket ids arrive as strings — the pool is configured with
 * `bigNumberStrings`, and `tickets.id` is a BIGINT that would lose precision
 * as a JS number. Never coerce these to Number.
 */
export function parseClickUpSyncCursor(value: unknown): ClickUpSyncCursor {
  if (value && typeof value === "object" && "afterTicketId" in value) {
    const raw = (value as { afterTicketId: unknown }).afterTicketId
    if (typeof raw === "string" && raw.length > 0) {
      return { afterTicketId: raw }
    }
  }
  return INITIAL_CLICKUP_SYNC_CURSOR
}

/**
 * Advance past the batch just processed.
 *
 * A short batch means the last page was reached, so the run is done. Comparing
 * against `sliceSize` rather than emptiness saves one wasted round trip per
 * run.
 */
export function advanceTicketCursor(
  cursor: ClickUpSyncCursor,
  batch: readonly { id: string }[],
  sliceSize: number
): { cursor: ClickUpSyncCursor; done: boolean } {
  if (batch.length === 0) {
    return { cursor, done: true }
  }
  const last = batch[batch.length - 1]
  return {
    cursor: { afterTicketId: last.id },
    done: batch.length < sliceSize,
  }
}
