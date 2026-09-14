import getPool from "./db.ts"
import {
  claimNextJobRun,
  checkpointJobRun,
  completeJobRun,
  expireStaleLeases,
  withJobTypeLock,
  yieldJobRun,
} from "./job-runner.ts"
import {
  computeLeaseSeconds,
  DEFAULT_SLICE_BUDGET_MS,
  hasBudget,
} from "./job-runner-core.ts"
import { reapExpiredJobArtifacts } from "./job-artifacts.ts"
import { writeJobRunItems } from "./job-progress.ts"
import { JOB_HANDLERS, JOB_TYPE_ORDER } from "./job-registry.ts"
import type { JobSliceContext } from "./job-registry.ts"
import { createLogger } from "./logger.ts"

const log = createLogger("job-tick")

export type JobTickResult = {
  reclaimed: number
  abandoned: number
  artifactsReaped: number
  ran: Array<{
    jobType: string
    jobRunId: string
    status: string
    processed: number
  }>
  skippedLocked: string[]
}

function resolveTickBudgetMs(): number {
  const raw = Number(process.env.JOBS_TICK_BUDGET_MS ?? DEFAULT_SLICE_BUDGET_MS)
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_SLICE_BUDGET_MS
}

/**
 * One pass of the job runner.
 *
 * Runs in the web process on a cron schedule rather than as a background
 * promise or a separate worker: a detached promise is exactly what strands a
 * job on deploy today, and a second entry point would need its own dependency
 * tree because `output: "standalone"` only traces what `server.js` reaches.
 *
 * GET_LOCK makes N replicas ticking simultaneously produce exactly one worker,
 * and the budget keeps every request comfortably under a proxy timeout.
 */
export type JobSliceReport = {
  jobType: string
  jobRunId: string
  status: string
  processed: number
}

/**
 * Run at most one slice of `jobType` under its advisory lock.
 *
 * Returns null when another process holds the lock, and undefined when there is
 * nothing queued. Shared by the cron tick and the per-job routes so a manual
 * trigger and a scheduled one take exactly the same path.
 */
export async function driveJobType(
  jobType: string,
  deadlineAt: number = Date.now() + resolveTickBudgetMs(),
  leaseSeconds: number = computeLeaseSeconds(resolveTickBudgetMs())
): Promise<JobSliceReport | null | undefined> {
  const handler = JOB_HANDLERS[jobType]
  if (!handler) {
    return undefined
  }

  return withJobTypeLock(jobType, async (connection) => {
    const claim = await claimNextJobRun(connection, jobType, leaseSeconds)
    if (!claim) {
      return undefined
    }

    const context: JobSliceContext = {
      db: connection,
      jobRunId: claim.id,
      attempt: claim.attempt,
      deadlineAt,
      checkpoint: async ({ cursor, progress, items }) => {
        // Items first: they are the write-ahead log, so a crash between the two
        // replays at most one batch — and the upsert makes that safe.
        if (items?.length) {
          await writeJobRunItems(connection, claim.id, items)
        }
        return checkpointJobRun(connection, {
          jobRunId: claim.id,
          cursor,
          progress,
          processedUnits: progress.processed,
          totalUnits: progress.totalUnits || null,
          leaseSeconds,
        })
      },
    }

    try {
      const result = await handler.handle(context, claim.params, claim.cursor)
      if (result.done) {
        await completeJobRun(connection, {
          jobRunId: claim.id,
          status: result.status,
          progress: result.progress,
          errorMessage: result.errorMessage ?? null,
        })
      } else {
        await yieldJobRun(connection, claim.id)
      }
      return {
        jobType,
        jobRunId: claim.id,
        status: result.done ? result.status : "yielded",
        processed: result.progress.processed,
      }
    } catch (error) {
      log.error("Job slice threw; leaving it for the reaper", error, {
        jobType,
        jobRunId: claim.id,
        attempt: claim.attempt,
      })
      // Deliberately not completed here: the lease lapses and the reaper
      // decides whether attempts remain, so there is one retry policy rather
      // than two that can disagree.
      throw error
    }
  })
}

export async function runJobTick(): Promise<JobTickResult> {
  const pool = getPool()
  const deadlineAt = Date.now() + resolveTickBudgetMs()
  const leaseSeconds = computeLeaseSeconds(resolveTickBudgetMs())

  // Reap first, so a run stranded by the last deploy is claimable in this pass.
  const { reclaimed, abandoned } = await expireStaleLeases(pool)

  // Retained source files whose retention window has passed. Failures here are
  // logged inside and must not stop the tick from doing its actual work.
  let artifactsReaped = 0
  try {
    artifactsReaped = await reapExpiredJobArtifacts(pool)
  } catch (error) {
    log.error("Artifact reaping failed", error)
  }

  const ran: JobTickResult["ran"] = []
  const skippedLocked: string[] = []

  for (const jobType of JOB_TYPE_ORDER) {
    if (!hasBudget(deadlineAt, Date.now())) {
      break
    }
    const outcome = await driveJobType(jobType, deadlineAt, leaseSeconds)
    if (outcome === null) {
      skippedLocked.push(jobType)
    } else if (outcome) {
      ran.push(outcome)
    }
  }

  return { reclaimed, abandoned, artifactsReaped, ran, skippedLocked }
}
