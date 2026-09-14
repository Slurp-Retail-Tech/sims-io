import type { RowDataPacket } from "mysql2/promise"

import type { Queryable } from "./db.ts"
import { createLogger } from "./logger.ts"
import { PLUS_IMPORT_JOB_TYPE } from "./job-types.ts"
import { deleteObject } from "./storage.ts"

const log = createLogger("job-artifacts")

/** Hours a finished run's source file is kept so the run can still be retried. */
function retentionHours(): number {
  const raw = Number(process.env.PLUS_UPLOAD_RETENTION_HOURS ?? 72)
  return Number.isFinite(raw) && raw > 0 ? raw : 72
}

/** Bounded per tick so a backlog cannot monopolise a cycle. */
const REAP_BATCH = 50

/**
 * Delete retained spreadsheets belonging to runs that finished long enough ago.
 *
 * Retention runs from the run reaching a terminal state, not from upload: a job
 * that never terminates keeps its source indefinitely, which is the correct
 * bias — the alternative deletes the input of a job that may still need it.
 */
export async function reapExpiredJobArtifacts(db: Queryable): Promise<number> {
  const bucket = process.env.MINIO_BUCKET
  if (!bucket) {
    return 0
  }

  const [rows] = await db.query<
    Array<RowDataPacket & { id: string; artifact_key: string }>
  >(
    `SELECT id, artifact_key
       FROM job_runs
      WHERE job_type = ?
        AND status IN ('succeeded', 'failed', 'cancelled')
        AND artifact_key IS NOT NULL
        AND artifact_deleted_at IS NULL
        AND finished_at < DATE_SUB(NOW(3), INTERVAL ? HOUR)
      ORDER BY finished_at ASC
      LIMIT ?`,
    [PLUS_IMPORT_JOB_TYPE, retentionHours(), REAP_BATCH]
  )

  let deleted = 0
  for (const row of rows) {
    try {
      await deleteObject(bucket, row.artifact_key)
    } catch (error) {
      // A key that is already gone is a success for our purposes: the goal is
      // "not present", and stamping it stops us retrying forever.
      const code =
        error && typeof error === "object" && "name" in error
          ? String((error as { name: unknown }).name)
          : ""
      if (code !== "NoSuchKey" && code !== "NotFound") {
        log.error("Failed to delete a retained upload", error, {
          jobRunId: row.id,
        })
        continue
      }
    }

    await db.query(
      "UPDATE job_runs SET artifact_deleted_at = NOW(3) WHERE id = ?",
      [row.id]
    )
    deleted += 1
  }

  return deleted
}
