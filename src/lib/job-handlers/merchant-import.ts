import getPool from "../db.ts"
import { hasBudget } from "../job-runner-core.ts"
import { EMPTY_PROGRESS, type JobProgress } from "../job-progress.ts"
import type { JobHandler, JobSliceOutcome } from "../job-registry.ts"
import { createLogger } from "../logger.ts"
import {
  advancePageCursor,
  parseMerchantImportCursor,
} from "../merchant-import-cursor.ts"
import { importMerchantPage } from "../merchant-import.ts"
import { authenticatePosApiSession } from "../pos-api.ts"

import { MERCHANT_IMPORT_JOB_TYPE } from "../job-types.ts"

export { MERCHANT_IMPORT_JOB_TYPE }

const log = createLogger("job:merchant-import")

const PER_PAGE = 100

/**
 * Ceiling the old `while (hasMore)` loop lacked: a POS endpoint that keeps
 * returning full pages would otherwise loop until the request died.
 */
const MAX_PAGES = (() => {
  const raw = Number(process.env.MERCHANT_IMPORT_MAX_PAGES ?? 500)
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 500
})()

function readProgress(value: unknown): JobProgress {
  if (value && typeof value === "object") {
    return { ...EMPTY_PROGRESS, ...(value as Partial<JobProgress>) }
  }
  return { ...EMPTY_PROGRESS }
}

/**
 * Walks the POS merchant feed a page at a time, checkpointing the page cursor
 * after each one.
 *
 * Resuming is safe because every write is an upsert
 * (`ON DUPLICATE KEY UPDATE`), so replaying a page after a reclaimed lease is a
 * no-op rather than a duplicate.
 */
export const merchantImportJobHandler: JobHandler = {
  jobType: MERCHANT_IMPORT_JOB_TYPE,
  async handle(context, _params, cursorValue): Promise<JobSliceOutcome> {
    let cursor = parseMerchantImportCursor(cursorValue)
    let progress = readProgress(null)
    progress.processed = cursor.imported

    // One session per slice. It re-authenticates on a 401 inside
    // importMerchantPage, and a fresh slice starting fresh is cheaper than
    // persisting a token.
    let session = await authenticatePosApiSession()
    const pool = getPool()

    while (hasBudget(context.deadlineAt, Date.now())) {
      const page = await importMerchantPage({
        pool,
        session,
        page: cursor.page,
        perPage: PER_PAGE,
      })
      session = page.session

      const advanced = advancePageCursor(
        cursor,
        page.itemsReturned,
        PER_PAGE,
        MAX_PAGES
      )
      cursor = advanced.cursor

      progress = {
        ...progress,
        processed: cursor.imported,
        updated: progress.updated + page.imported,
        currentLabel: page.lastLabel ?? progress.currentLabel,
      }

      const alive = await context.checkpoint({ cursor, progress })
      if (!alive) {
        // Lease stolen mid-slice: stop without further external work.
        log.warn("Lease lost mid-slice; aborting", {
          jobRunId: context.jobRunId,
        })
        return { done: false, progress }
      }

      if (advanced.done) {
        if (advanced.reason === "max-pages") {
          // Reported as a failure rather than a success: silently stopping at
          // the cap would look like a complete import that simply found less.
          log.error(
            "Hit the page ceiling; import stopped short",
            new Error(`Reached MERCHANT_IMPORT_MAX_PAGES (${MAX_PAGES})`),
            { jobRunId: context.jobRunId, page: cursor.page }
          )
          return {
            done: true,
            status: "failed",
            progress,
            errorMessage: `Stopped after ${MAX_PAGES} pages (MERCHANT_IMPORT_MAX_PAGES). The POS feed did not signal an end.`,
          }
        }
        return { done: true, status: "succeeded", progress }
      }
    }

    return { done: false, progress }
  },
}
