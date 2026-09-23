import { EMPTY_PROGRESS, type JobProgress } from "../job-progress.ts"
import type { JobHandler, JobSliceOutcome } from "../job-registry.ts"
import { RENEWAL_DISPATCH_JOB_TYPE } from "../job-types.ts"
import { createLogger } from "../logger.ts"
import { sendDueDispatches } from "../renewal/dispatch-sender.ts"

export { RENEWAL_DISPATCH_JOB_TYPE }

const log = createLogger("job:renewal-dispatch")

/**
 * Send the renewal messages that are due, within the slice's budget.
 *
 * Returns not-done while due rows remain, so the next tick carries on from
 * where this one stopped. Rows due later (a reminder held for the send
 * window, a retry after a failure) are picked up by the next scheduled run
 * of `POST /api/renewals/dispatch`, not by keeping this job alive.
 */
export const renewalDispatchJobHandler: JobHandler = {
  jobType: RENEWAL_DISPATCH_JOB_TYPE,
  async handle(context): Promise<JobSliceOutcome> {
    try {
      const report = await sendDueDispatches({ deadlineAt: context.deadlineAt })
      const handled = report.sent + report.retried + report.failed + report.cancelled + report.deferred
      const progress: JobProgress = {
        ...EMPTY_PROGRESS,
        totalUnits: handled,
        processed: handled,
        updated: report.sent,
        skipped: report.cancelled + report.deferred,
        failed: report.failed,
        currentLabel: report.skippedReason ?? (report.rateLimited ? "rate limited" : "sent"),
      }
      if (report.skippedReason) {
        log.info("Renewal dispatch skipped", { reason: report.skippedReason })
      } else if (handled > 0 || report.interrupted > 0) {
        log.info("Renewal dispatch pass", { ...report })
      }
      return report.more ? { done: false, progress } : { done: true, status: "succeeded", progress }
    } catch (error) {
      log.error("Renewal dispatch failed", error, { jobRunId: context.jobRunId })
      return {
        done: true,
        status: "failed",
        progress: { ...EMPTY_PROGRESS },
        errorMessage: error instanceof Error ? error.message : "Renewal dispatch failed",
      }
    }
  },
}
