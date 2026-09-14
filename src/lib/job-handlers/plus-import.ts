import { hasBudget } from "../job-runner-core.ts"
import {
  EMPTY_PROGRESS,
  type JobProgress,
  type JobRunItemInput,
} from "../job-progress.ts"
import type { JobHandler, JobSliceOutcome } from "../job-registry.ts"
import { createLogger } from "../logger.ts"
import { PLUS_IMPORT_JOB_TYPE } from "../job-types.ts"
import { runPlusUpdateJob } from "../plus-import.ts"
import { rowOutcome, type PlusPhaseRecord } from "../plus-import-plan.ts"

export { PLUS_IMPORT_JOB_TYPE }

const log = createLogger("job:plus-import")

/** Rows one slice may attempt before yielding, independent of the deadline. */
const MAX_ROWS_PER_SLICE = 250

type PlusCursor = {
  rowIndex: number
  fingerprint: string | null
}

function parseCursor(value: unknown): PlusCursor {
  if (value && typeof value === "object") {
    const raw = value as { rowIndex?: unknown; fingerprint?: unknown }
    const rowIndex = Number(raw.rowIndex)
    return {
      rowIndex: Number.isInteger(rowIndex) && rowIndex >= 0 ? rowIndex : 0,
      fingerprint:
        typeof raw.fingerprint === "string" && raw.fingerprint.length > 0
          ? raw.fingerprint
          : null,
    }
  }
  return { rowIndex: 0, fingerprint: null }
}

type PlusParams = { plusJobId?: string }

/**
 * Drives a PLUS spreadsheet update in bounded slices.
 *
 * The legacy `plus_update_jobs` row is still written by runPlusUpdateJob, so
 * the existing UI keeps working unchanged; job_runs carries the durability —
 * the cursor, the lease and the retained source file.
 */
export const plusImportJobHandler: JobHandler = {
  jobType: PLUS_IMPORT_JOB_TYPE,
  async handle(context, params, cursorValue): Promise<JobSliceOutcome> {
    const plusJobId = (params as PlusParams | null)?.plusJobId
    if (!plusJobId) {
      return {
        done: true,
        status: "failed",
        progress: { ...EMPTY_PROGRESS },
        errorMessage: "Job is missing its PLUS job id.",
      }
    }

    const cursor = parseCursor(cursorValue)
    let progress: JobProgress = { ...EMPTY_PROGRESS }
    const pending: JobRunItemInput[] = []

    if (!hasBudget(context.deadlineAt, Date.now())) {
      return { done: false, progress }
    }

    try {
      const result = await runPlusUpdateJob(plusJobId, () => undefined, {
        fromRowIndex: cursor.rowIndex,
        maxRows: MAX_ROWS_PER_SLICE,
        deadlineAt: context.deadlineAt,
        expectedFingerprint: cursor.fingerprint,
        onRowComplete: async (state) => {
          const phases = state.phases as Record<string, PlusPhaseRecord> | null
          pending.push({
            unitIndex: state.rowIndex - 1,
            unitKey: state.fid,
            // A row whose merchant id landed but whose category failed is
            // "partial", not a whole-row failure — and its phases carry the
            // pre-images needed to finish or undo it by hand.
            outcome: phases
              ? (rowOutcome(phases) as JobRunItemInput["outcome"])
              : "skipped",
            phases: phases ?? null,
          })

          progress = {
            ...progress,
            totalUnits: state.summary.totalRows,
            processed: state.summary.processed,
            updated: state.summary.updatedCount,
            skipped: state.summary.skippedCount,
            failed: state.summary.failedCount,
            currentLabel: state.fid,
          }

          const items = pending.splice(0, pending.length)
          return context.checkpoint({
            cursor: {
              rowIndex: state.rowIndex,
              fingerprint: cursor.fingerprint,
            },
            progress,
            items,
          })
        },
      })

      // First slice: pin the fingerprint so later ones verify the same file.
      if (!cursor.fingerprint) {
        await context.checkpoint({
          cursor: {
            rowIndex: result.nextRowIndex,
            fingerprint: result.fingerprint,
          },
          progress,
          items: pending.splice(0, pending.length),
        })
      }

      if (result.aborted) {
        // Lease lost mid-slice; the run belongs to another process now.
        log.warn("Lease lost mid-slice; aborting", {
          jobRunId: context.jobRunId,
        })
        return { done: false, progress }
      }
      if (result.done) {
        return { done: true, status: "succeeded", progress }
      }
      return { done: false, progress }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "PLUS update failed."
      // A changed or missing source file is terminal, not retryable: no number
      // of attempts recovers a file that is gone or different.
      const terminal =
        message.includes("changed between attempts") ||
        message.includes("NoSuchKey")
      if (!terminal) {
        throw error
      }
      log.error("PLUS run cannot continue", error, {
        jobRunId: context.jobRunId,
      })
      return {
        done: true,
        status: "failed",
        progress,
        errorMessage: message,
      }
    }
  },
}
