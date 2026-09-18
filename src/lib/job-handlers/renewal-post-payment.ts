import { EMPTY_PROGRESS, type JobProgress } from "../job-progress.ts"
import type { JobHandler, JobSliceOutcome } from "../job-registry.ts"
import { RENEWAL_POST_PAYMENT_JOB_TYPE } from "../job-types.ts"
import { createLogger } from "../logger.ts"
import { runPostPayment } from "../renewal/post-payment.ts"

export { RENEWAL_POST_PAYMENT_JOB_TYPE }

const log = createLogger("job:renewal-post-payment")

type Params = { invoiceId?: string; forcePayerEmail?: boolean }

/**
 * The steps that follow a confirmed payment, for one invoice.
 *
 * One slice. Each step is idempotent and records its own state on the
 * invoice, so an interrupted run picks up where it stopped. A step that fails
 * is recorded on the row and raised in Actions Required; it is not a job
 * failure, because retrying the job would not change a POS that is down, and
 * the hourly reconcile re-queues outstanding steps inside the retry window.
 */
export const renewalPostPaymentJobHandler: JobHandler = {
  jobType: RENEWAL_POST_PAYMENT_JOB_TYPE,
  async handle(context, params): Promise<JobSliceOutcome> {
    const invoiceId = (params as Params | null)?.invoiceId
    if (!invoiceId || !/^\d+$/.test(invoiceId)) {
      return {
        done: true,
        status: "failed",
        progress: { ...EMPTY_PROGRESS },
        errorMessage: "Post-payment job needs an invoiceId.",
      }
    }

    try {
      const report = await runPostPayment(invoiceId, {
        forcePayerEmail: Boolean((params as Params | null)?.forcePayerEmail),
      })
      const failed = report.steps.filter((step) => step.outcome === "failed").length
      const progress: JobProgress = {
        ...EMPTY_PROGRESS,
        totalUnits: report.steps.length,
        processed: report.steps.length,
        updated: report.steps.filter((step) => step.outcome === "done").length,
        skipped: report.steps.filter((step) => step.outcome === "skipped").length,
        failed,
        currentLabel: `invoice ${invoiceId}`,
      }
      return { done: true, status: "succeeded", progress }
    } catch (error) {
      log.error("Post-payment job failed", error, { invoiceId, jobRunId: context.jobRunId })
      return {
        done: true,
        status: "failed",
        progress: { ...EMPTY_PROGRESS, currentLabel: `invoice ${invoiceId}` },
        errorMessage: error instanceof Error ? error.message : "Post-payment job failed",
      }
    }
  },
}
