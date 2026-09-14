import type { PoolConnection } from "mysql2/promise"

import type { JobProgress, JobRunItemInput } from "./job-progress.ts"
import { clickUpSyncJobHandler } from "./job-handlers/clickup-sync.ts"
import { merchantImportJobHandler } from "./job-handlers/merchant-import.ts"
import { plusImportJobHandler } from "./job-handlers/plus-import.ts"

/**
 * What a job handler is handed for one slice of work.
 *
 * A slice is bounded: the handler processes units until `deadlineAt` is close,
 * then returns `done: false` and is re-entered on a later tick from its saved
 * cursor. That, rather than running to completion, is what lets a job survive a
 * deploy.
 */
export type JobSliceContext = {
  /** The pinned connection holding this job type's advisory lock. */
  db: PoolConnection
  jobRunId: string
  attempt: number
  /** Epoch ms after which the slice must stop and yield. */
  deadlineAt: number
  /**
   * Persist progress and advance the cursor.
   *
   * Returns false when the lease was stolen. A handler MUST stop immediately on
   * false and perform no further external writes — the run now belongs to
   * another process.
   */
  checkpoint: (input: {
    cursor: unknown
    progress: JobProgress
    items?: readonly JobRunItemInput[]
  }) => Promise<boolean>
}

export type JobSliceOutcome =
  | {
      done: true
      status: "succeeded" | "failed"
      progress: JobProgress
      errorMessage?: string
    }
  | { done: false; progress: JobProgress }

export type JobHandler = {
  jobType: string
  handle: (
    context: JobSliceContext,
    params: unknown,
    cursor: unknown
  ) => Promise<JobSliceOutcome>
}

/**
 * Registered handlers, in tick order: a user-visible job must never wait behind
 * a nightly bulk one.
 *
 * Registry-driven so each job type can be migrated onto the runner
 * independently — a type with no handler here is simply not ticked.
 */
export const JOB_HANDLERS: Record<string, JobHandler> = {
  [clickUpSyncJobHandler.jobType]: clickUpSyncJobHandler,
  [merchantImportJobHandler.jobType]: merchantImportJobHandler,
  [plusImportJobHandler.jobType]: plusImportJobHandler,
}

export function registerJobHandler(handler: JobHandler): void {
  JOB_HANDLERS[handler.jobType] = handler
}

/** Order is deliberate; see JOB_HANDLERS. */
export const JOB_TYPE_ORDER: readonly string[] = [
  "plus-import",
  "merchant-import",
  "clickup-sync",
]
