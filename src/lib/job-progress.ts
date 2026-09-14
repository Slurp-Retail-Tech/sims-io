import type { Queryable } from "./db.ts"

/**
 * Fixed-size progress counters.
 *
 * Deliberately has no array field. The writer this replaces persisted a summary
 * object that grew with every processed row and was re-serialized on each
 * write, so a 3000-row spreadsheet meant 3000 progressively larger UPDATEs.
 * Per-unit detail belongs in `job_run_items`.
 */
export type JobProgress = {
  totalUnits: number
  processed: number
  updated: number
  skipped: number
  failed: number
  partial: number
  /** Last unit label, for the UI. Truncated — never accumulates. */
  currentLabel: string | null
}

export const EMPTY_PROGRESS: JobProgress = {
  totalUnits: 0,
  processed: 0,
  updated: 0,
  skipped: 0,
  failed: 0,
  partial: 0,
  currentLabel: null,
}

export type JobUnitOutcome = "updated" | "skipped" | "failed" | "partial"

export type JobRunItemInput = {
  unitIndex: number
  unitKey: string
  outcome: JobUnitOutcome
  phases?: Record<string, unknown> | null
  message?: string | null
}

const MAX_LABEL_LENGTH = 120

export function truncateLabel(value: string | null | undefined): string | null {
  if (!value) {
    return null
  }
  return value.length <= MAX_LABEL_LENGTH
    ? value
    : `${value.slice(0, MAX_LABEL_LENGTH - 1)}…`
}

/**
 * Fold a batch of unit outcomes into the running counters. Pure, so the
 * fixed-size guarantee is testable.
 */
export function mergeProgress(
  progress: JobProgress,
  items: readonly JobRunItemInput[]
): JobProgress {
  const next: JobProgress = { ...progress }
  for (const item of items) {
    next.processed += 1
    next[item.outcome] += 1
    next.currentLabel = truncateLabel(item.unitKey) ?? next.currentLabel
  }
  return next
}

export function summarizeOutcomes(
  items: readonly JobRunItemInput[]
): Record<JobUnitOutcome, number> {
  const totals: Record<JobUnitOutcome, number> = {
    updated: 0,
    skipped: 0,
    failed: 0,
    partial: 0,
  }
  for (const item of items) {
    totals[item.outcome] += 1
  }
  return totals
}

/**
 * Write a batch of unit outcomes as one statement.
 *
 * Upserts on (job_run_id, unit_index) so a replayed slice — the normal
 * consequence of a reclaimed lease — updates its rows rather than duplicating
 * them. Items are written BEFORE the cursor advances, making them the
 * write-ahead log for the checkpoint.
 */
export async function writeJobRunItems(
  db: Queryable,
  jobRunId: string,
  items: readonly JobRunItemInput[]
): Promise<void> {
  if (items.length === 0) {
    return
  }

  const tuples = items.map(() => "(?, ?, ?, ?, CAST(? AS JSON), ?)").join(", ")
  const values: Array<string | number | null> = []
  for (const item of items) {
    values.push(
      jobRunId,
      item.unitIndex,
      item.unitKey.slice(0, 191),
      item.outcome,
      item.phases ? JSON.stringify(item.phases) : null,
      item.message ?? null
    )
  }

  await db.query(
    `INSERT INTO job_run_items
       (job_run_id, unit_index, unit_key, outcome, phases_json, message)
     VALUES ${tuples}
     ON DUPLICATE KEY UPDATE
       unit_key = VALUES(unit_key),
       outcome = VALUES(outcome),
       phases_json = VALUES(phases_json),
       message = VALUES(message)`,
    values
  )
}
