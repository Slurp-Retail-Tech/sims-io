import { hasBudget } from "../job-runner-core.ts"
import { EMPTY_PROGRESS, type JobProgress } from "../job-progress.ts"
import type { JobHandler, JobSliceOutcome } from "../job-registry.ts"
import { createLogger } from "../logger.ts"

import { RENEWAL_SUBSCRIPTION_SYNC_JOB_TYPE } from "../job-types.ts"
import { decideSubscriptionSync } from "../renewal/subscription-sync.ts"
import type { ValidUntilDrift } from "../renewal/subscription-sync.ts"
import { reconcileDriftForBatch } from "../renewal/pos-drift-store.ts"
import {
  applySubscriptionChanges,
  insertSubscription,
  loadExistingSubscriptions,
  readPosOutletBatch,
  subscriptionKey,
  touchSyncedAt,
} from "../renewal/subscriptions.ts"

export { RENEWAL_SUBSCRIPTION_SYNC_JOB_TYPE }

const log = createLogger("job:renewal-subscription-sync")

type SyncCursor = {
  /** Highest merchant_outlets.id already projected. */
  afterRowId: string | null
}

/**
 * Parse the persisted cursor defensively.
 *
 * A cursor is handler-shaped JSON that survives deploys, so it may have been
 * written by an older build. Anything unrecognised restarts the walk, which is
 * safe: the projection is an upsert, so re-walking rewrites the same rows.
 */
function parseCursor(value: unknown): SyncCursor {
  if (value && typeof value === "object" && "afterRowId" in value) {
    const raw = (value as { afterRowId: unknown }).afterRowId
    if (typeof raw === "string" && /^\d+$/.test(raw)) {
      return { afterRowId: raw }
    }
  }
  return { afterRowId: null }
}

/**
 * Project every POS outlet into `outlet_subscriptions`.
 *
 * This is what makes SIMS the system of record for `valid_until`. The import
 * writes `merchant_outlets.raw_payload` wholesale every night, so nothing SIMS
 * wrote there survived; the projection is the copy SIMS owns and extends on
 * payment.
 *
 * Runs before the renewal cycle detector each night, so the detector reads a
 * projection that already reflects this morning's import.
 *
 * Walks in keyset batches, checkpointing after each, so a deploy mid-run
 * resumes from the last outlet rather than restarting. The work is idempotent
 * either way -- every write is an upsert keyed on (franchise_id, outlet_id) --
 * so a repeated batch costs time and nothing else.
 */
export const renewalSubscriptionSyncJobHandler: JobHandler = {
  jobType: RENEWAL_SUBSCRIPTION_SYNC_JOB_TYPE,
  async handle(context, _params, cursorValue): Promise<JobSliceOutcome> {
    let cursor = parseCursor(cursorValue)
    let progress: JobProgress = { ...EMPTY_PROGRESS }

    while (hasBudget(context.deadlineAt, Date.now())) {
      const batch = await readPosOutletBatch(cursor.afterRowId)

      if (batch.snapshots.length === 0 && !batch.hasMore) {
        return { done: true, status: "succeeded", progress }
      }

      const existing = await loadExistingSubscriptions(batch.snapshots)
      const untouched: string[] = []
      const drifts: ValidUntilDrift[] = []

      for (const snapshot of batch.snapshots) {
        const key = subscriptionKey(snapshot.franchiseId, snapshot.outletId)
        const decision = decideSubscriptionSync(snapshot, existing.get(key) ?? null)

        if (decision.action !== "insert" && decision.drift) {
          drifts.push(decision.drift)
        }

        try {
          if (decision.action === "insert") {
            const inserted = await insertSubscription(snapshot)
            progress = {
              ...progress,
              // A row that lost the insert race already exists and is correct,
              // so it counts as skipped rather than as a failure.
              updated: progress.updated + (inserted ? 1 : 0),
              skipped: progress.skipped + (inserted ? 0 : 1),
            }
          } else if (decision.action === "update") {
            await applySubscriptionChanges(decision.id, decision.changes)
            progress = { ...progress, updated: progress.updated + 1 }
          } else {
            untouched.push(decision.id)
            progress = { ...progress, skipped: progress.skipped + 1 }
          }
        } catch (error) {
          // One bad outlet must not abandon the rest of the walk. The row keeps
          // its previous values and the next run retries it.
          progress = { ...progress, failed: progress.failed + 1 }
          log.error("Subscription projection failed for outlet", error, {
            franchiseId: snapshot.franchiseId,
            outletId: snapshot.outletId,
          })
        }

        progress = {
          ...progress,
          processed: progress.processed + 1,
          currentLabel: snapshot.outletName ?? snapshot.outletId,
        }
      }

      await touchSyncedAt(untouched)
      await reportDrift(batch.snapshots, drifts)

      cursor = { afterRowId: batch.lastRowId ?? cursor.afterRowId }

      const alive = await context.checkpoint({ cursor, progress })
      if (!alive) {
        // Lease stolen: this run belongs to another process now. Stop without
        // further writes rather than double-applying its work.
        log.warn("Lease lost mid-slice; aborting", { jobRunId: context.jobRunId })
        return { done: false, progress }
      }

      if (!batch.hasMore) {
        return { done: true, status: "succeeded", progress }
      }
    }

    return { done: false, progress }
  },
}

/**
 * Surface outlets where POS runs ahead of the date SIMS extended to.
 *
 * That means somebody renewed outside SIMS. Neither value is safely
 * discardable, so each becomes an informational Actions Required entry where
 * a person decides, and entries for outlets in this batch that no longer
 * drift are cleared. A queue failure is logged and never fails the sync: the
 * projection is what the renewal cycle depends on.
 */
async function reportDrift(
  examined: ReadonlyArray<{ franchiseId: string; outletId: string }>,
  drifts: readonly ValidUntilDrift[]
): Promise<void> {
  try {
    await reconcileDriftForBatch(examined, drifts)
  } catch (error) {
    log.error("Could not record POS drift in Actions Required", error, { drifts: drifts.length })
  }
  for (const drift of drifts) {
    log.warn("POS valid_until is ahead of the SIMS-extended date", {
      franchiseId: drift.franchiseId,
      outletId: drift.outletId,
      simsValidUntil: drift.simsValidUntil,
      posValidUntil: drift.posValidUntil,
    })
  }
}
