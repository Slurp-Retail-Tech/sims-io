import {
  advanceTicketCursor,
  parseClickUpSyncCursor,
} from "../clickup-sync-cursor.ts"
import {
  CLICKUP_SYNC_SLICE_SIZE,
  syncClickUpTicketBatch,
} from "../clickup-ticket-sync.ts"
import { hasBudget } from "../job-runner-core.ts"
import { EMPTY_PROGRESS, type JobProgress } from "../job-progress.ts"
import type { JobHandler, JobSliceOutcome } from "../job-registry.ts"
import { createLogger } from "../logger.ts"

import { CLICKUP_SYNC_JOB_TYPE } from "../job-types.ts"

export { CLICKUP_SYNC_JOB_TYPE }

const log = createLogger("job:clickup-sync")

type ClickUpSyncParams = {
  actorLabel?: string
}

function readProgress(value: unknown): JobProgress {
  if (value && typeof value === "object") {
    return { ...EMPTY_PROGRESS, ...(value as Partial<JobProgress>) }
  }
  return { ...EMPTY_PROGRESS }
}

/**
 * Walks every ClickUp-linked ticket in keyset batches, checkpointing after each
 * one so a deploy mid-run resumes from the last synced ticket instead of
 * restarting from the beginning.
 */
export const clickUpSyncJobHandler: JobHandler = {
  jobType: CLICKUP_SYNC_JOB_TYPE,
  async handle(context, params, cursorValue): Promise<JobSliceOutcome> {
    const actorLabel =
      (params as ClickUpSyncParams | null)?.actorLabel ?? "ClickUp Cron Sync"
    let cursor = parseClickUpSyncCursor(cursorValue)
    let progress = readProgress(null)

    // Counters restart each run rather than resuming: this job has no fixed
    // total, and a resumed run reporting the previous slice's counts would be
    // misleading. The cursor is what carries position.
    while (hasBudget(context.deadlineAt, Date.now())) {
      const batch = await syncClickUpTicketBatch({
        actorLabel,
        afterTicketId: cursor.afterTicketId,
        limit: CLICKUP_SYNC_SLICE_SIZE,
        deadlineAt: context.deadlineAt,
      })

      progress = {
        ...progress,
        processed: progress.processed + batch.processed,
        updated: progress.updated + batch.synced,
        skipped: progress.skipped + batch.skipped,
        failed: progress.failed + batch.failed,
        currentLabel: batch.lastTicketId,
      }

      for (const failure of batch.errors) {
        log.warn("Ticket sync failed", {
          ticketId: failure.ticketId,
          error: failure.error,
        })
      }

      const advanced = advanceTicketCursor(
        cursor,
        batch.lastTicketId ? [{ id: batch.lastTicketId }] : [],
        // A batch that stopped on the deadline is not a short page, so compare
        // against what was actually processed rather than the slice size.
        batch.done ? CLICKUP_SYNC_SLICE_SIZE : 0
      )
      cursor = advanced.cursor

      const alive = await context.checkpoint({ cursor, progress })
      if (!alive) {
        // Lease stolen: this run belongs to another process now. Stop without
        // further writes rather than double-applying its work.
        log.warn("Lease lost mid-slice; aborting", { jobRunId: context.jobRunId })
        return { done: false, progress }
      }

      if (batch.done) {
        return { done: true, status: "succeeded", progress }
      }
      if (batch.processed === 0) {
        return { done: true, status: "succeeded", progress }
      }
    }

    return { done: false, progress }
  },
}
