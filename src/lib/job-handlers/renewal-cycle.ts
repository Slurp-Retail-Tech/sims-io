import { EMPTY_PROGRESS, type JobProgress } from "../job-progress.ts"
import type { JobHandler, JobSliceOutcome } from "../job-registry.ts"
import { createLogger } from "../logger.ts"

import { RENEWAL_CYCLE_JOB_TYPE } from "../job-types.ts"
import { runRenewalCycle } from "../renewal/cycle.ts"

export { RENEWAL_CYCLE_JOB_TYPE }

const log = createLogger("job:renewal-cycle")

type CycleParams = {
  /** Override the run date, for replaying a past night during investigation. */
  runDate?: string
}

/**
 * The nightly renewal cycle.
 *
 * Runs in one slice rather than checkpointing partway. The work is bounded by
 * how many subscriptions expire inside the readiness window — hundreds at
 * most, not tens of thousands — and a half-finished cycle is harder to reason
 * about than a repeated one: every write it makes is idempotent, so a re-run
 * after an interruption reaches the same state.
 */
export const renewalCycleJobHandler: JobHandler = {
  jobType: RENEWAL_CYCLE_JOB_TYPE,
  async handle(context, params): Promise<JobSliceOutcome> {
    const runDate = (params as CycleParams | null)?.runDate ?? todayInAppZone()

    try {
      const outcome = await runRenewalCycle(runDate)

      log.info("Renewal cycle complete", {
        runDate,
        offsets: outcome.offsetsRun.join(","),
        readinessWindowDays: outcome.readinessWindowDays,
        due: outcome.subscriptionsDue,
        upcoming: outcome.subscriptionsUpcoming,
        created: outcome.invoicesCreated,
        reused: outcome.invoicesReused,
        actionsRaised: outcome.actionsRaised,
        actionsResolved: outcome.actionsResolved,
        staleProformas: outcome.staleProformas,
      })

      // Units are every subscription examined, in either pass. `failed` is the
      // number of Actions Required entries raised, not a job failure.
      const examined = outcome.subscriptionsDue + outcome.subscriptionsUpcoming
      const progress: JobProgress = {
        ...EMPTY_PROGRESS,
        totalUnits: examined,
        processed: examined,
        updated: outcome.invoicesCreated,
        skipped: outcome.invoicesReused,
        failed: outcome.actionsRaised,
        currentLabel: runDate,
      }

      return { done: true, status: "succeeded", progress }
    } catch (error) {
      log.error("Renewal cycle failed", error, { runDate, jobRunId: context.jobRunId })
      return {
        done: true,
        status: "failed",
        progress: { ...EMPTY_PROGRESS, currentLabel: runDate },
        errorMessage: error instanceof Error ? error.message : "Renewal cycle failed",
      }
    }
  },
}

/**
 * Today in Asia/Kuala_Lumpur.
 *
 * The pool runs at UTC, so a job firing at 00:15 local time would otherwise
 * compute yesterday's date and invoice the wrong cohort.
 */
function todayInAppZone(): string {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kuala_Lumpur",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  })
  return formatter.format(new Date())
}
