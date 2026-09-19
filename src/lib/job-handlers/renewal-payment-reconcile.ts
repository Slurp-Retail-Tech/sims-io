import { getCommercePayClient } from "../commercepay/client.ts"
import { EMPTY_PROGRESS, type JobProgress } from "../job-progress.ts"
import type { JobHandler, JobSliceOutcome } from "../job-registry.ts"
import { RENEWAL_PAYMENT_RECONCILE_JOB_TYPE } from "../job-types.ts"
import { createLogger } from "../logger.ts"
import { reconcilePayments } from "../renewal/payment-reconcile.ts"

export { RENEWAL_PAYMENT_RECONCILE_JOB_TYPE }

const log = createLogger("job:renewal-payment-reconcile")

/**
 * The hourly Query sweep over open payment sessions, plus re-queuing of any
 * post-payment step still outstanding. One slice; the batch is bounded.
 */
export const renewalPaymentReconcileJobHandler: JobHandler = {
  jobType: RENEWAL_PAYMENT_RECONCILE_JOB_TYPE,
  async handle(context): Promise<JobSliceOutcome> {
    try {
      const client = await getCommercePayClient()
      if (!client) {
        log.info("CommercePay not configured; only re-queuing post-payment follow-ups")
      }
      const report = await reconcilePayments(client)
      log.info("Payment reconcile complete", { ...report })

      const progress: JobProgress = {
        ...EMPTY_PROGRESS,
        totalUnits: report.sessionsQueried,
        processed: report.sessionsQueried,
        updated: report.paidFound + report.closed + report.expired,
        skipped: report.followUpsQueued,
        failed: report.queryFailures,
        currentLabel: `${report.paidFound} paid found`,
      }
      return { done: true, status: "succeeded", progress }
    } catch (error) {
      log.error("Payment reconcile failed", error, { jobRunId: context.jobRunId })
      return {
        done: true,
        status: "failed",
        progress: { ...EMPTY_PROGRESS },
        errorMessage: error instanceof Error ? error.message : "Payment reconcile failed",
      }
    }
  },
}
