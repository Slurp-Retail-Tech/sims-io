import type { PoolConnection } from "mysql2/promise"

import type { JobProgress, JobRunItemInput } from "./job-progress.ts"
import { clickUpSyncJobHandler } from "./job-handlers/clickup-sync.ts"
import { merchantImportJobHandler } from "./job-handlers/merchant-import.ts"
import { plusImportJobHandler } from "./job-handlers/plus-import.ts"
import { renewalCycleJobHandler } from "./job-handlers/renewal-cycle.ts"
import { renewalDispatchJobHandler } from "./job-handlers/renewal-dispatch.ts"
import { renewalPaymentReconcileJobHandler } from "./job-handlers/renewal-payment-reconcile.ts"
import { renewalPostPaymentJobHandler } from "./job-handlers/renewal-post-payment.ts"
import { renewalSubscriptionSyncJobHandler } from "./job-handlers/renewal-subscription-sync.ts"

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
  [renewalSubscriptionSyncJobHandler.jobType]: renewalSubscriptionSyncJobHandler,
  [renewalCycleJobHandler.jobType]: renewalCycleJobHandler,
  [renewalPostPaymentJobHandler.jobType]: renewalPostPaymentJobHandler,
  [renewalPaymentReconcileJobHandler.jobType]: renewalPaymentReconcileJobHandler,
  [renewalDispatchJobHandler.jobType]: renewalDispatchJobHandler,
}

export function registerJobHandler(handler: JobHandler): void {
  JOB_HANDLERS[handler.jobType] = handler
}

/** Order is deliberate; see JOB_HANDLERS. */
export const JOB_TYPE_ORDER: readonly string[] = [
  // First: a merchant is sitting on the receipt page waiting for this.
  "renewal-post-payment",
  // Next: receipts to the PIC follow a payment, and reminders are time-bound.
  "renewal-dispatch",
  "plus-import",
  "merchant-import",
  // After merchant-import: the projection reads what that run just wrote, so
  // running it first would age its own input by a day.
  "renewal-subscription-sync",
  // And the cycle after the projection, for the same reason.
  "renewal-cycle",
  "renewal-payment-reconcile",
  "clickup-sync",
]
