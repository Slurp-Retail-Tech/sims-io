import { randomUUID } from "node:crypto"
import type { PoolConnection, ResultSetHeader, RowDataPacket } from "mysql2/promise"

import getPool from "./db.ts"
import type { Queryable } from "./db.ts"
import {
  computeLeaseSeconds,
  reclaimBackoffSeconds,
} from "./job-runner-core.ts"
import type { JobProgress } from "./job-progress.ts"
import { createLogger } from "./logger.ts"

const log = createLogger("job-runner")

/**
 * Per-process lease owner.
 *
 * Regenerated on every boot, which is the point: a process that comes back
 * after a deploy cannot fence a lease its predecessor held, so the reaper is
 * free to hand that run to whoever claims it next.
 */
const LEASE_OWNER = `${process.pid}-${randomUUID().slice(0, 8)}`

export type JobStatus =
  | "queued"
  | "running"
  | "succeeded"
  | "failed"
  | "cancelled"

export type JobClaim = {
  id: string
  jobType: string
  attempt: number
  params: unknown
  cursor: unknown
  artifactKey: string | null
  artifactFingerprint: string | null
}

type JobRunRow = RowDataPacket & {
  id: string
  job_type: string
  attempt: number
  params_json: unknown
  cursor_json: unknown
  artifact_key: string | null
  artifact_fingerprint: string | null
}

/** MySQL caps lock names at 64 bytes and job_type is VARCHAR(64) — keep it short. */
function jobLockName(jobType: string): string {
  return `sims_job:${jobType}`.slice(0, 64)
}

/**
 * Run `body` while holding the type-level advisory lock, on one pinned
 * connection. Returns null without running when another process holds it.
 *
 * GET_LOCK rather than a Redis lock because it auto-releases on disconnect: a
 * container killed mid-deploy drops its socket and MySQL frees the lock
 * immediately, whereas any Redis TTL is either too short (two runners) or too
 * long (a dead runner blocks the queue). scripts/migrate.mjs relies on the same
 * property.
 *
 * Timeout 0 — a try-lock, unlike the migration runner's 60. A cron tick must
 * return immediately rather than stack behind the previous one.
 */
export async function withJobTypeLock<T>(
  jobType: string,
  body: (connection: PoolConnection) => Promise<T>
): Promise<T | null> {
  const connection = await getPool().getConnection()
  let held = false

  try {
    const [rows] = await connection.query<
      Array<RowDataPacket & { got: number | null }>
    >("SELECT GET_LOCK(?, 0) AS got", [jobLockName(jobType)])
    held = Number(rows[0]?.got) === 1
    if (!held) {
      return null
    }
    return await body(connection)
  } finally {
    if (held) {
      try {
        await connection.query("SELECT RELEASE_LOCK(?)", [jobLockName(jobType)])
        connection.release()
      } catch (error) {
        // A connection we cannot cleanly unlock must never go back into a pool
        // with queueLimit 0 — it would hold the lock and stall every waiter.
        log.error("Failed to release job lock; destroying the connection", error, {
          jobType,
        })
        connection.destroy()
      }
    } else {
      connection.release()
    }
  }
}

export async function enqueueJobRun(
  db: Queryable,
  input: {
    jobType: string
    dedupeKey: string | null
    triggerSource: "cron" | "manual" | "api"
    requestedBy?: string | null
    params?: unknown
    artifactKey?: string | null
    maxAttempts?: number
  }
): Promise<{ jobRunId: string; created: boolean }> {
  const values = [
    input.jobType,
    input.dedupeKey,
    input.triggerSource,
    input.requestedBy ?? null,
    input.params === undefined ? null : JSON.stringify(input.params),
    input.artifactKey ?? null,
    input.maxAttempts ?? 5,
  ]

  try {
    // The UNIQUE (job_type, dedupe_key) index is the single-flight guard, so a
    // duplicate loses the race here rather than being checked for first — which
    // would be a read-then-write with the same race it is meant to prevent.
    //
    // Deliberately NOT `ON DUPLICATE KEY UPDATE`: MySQL reports affectedRows 1
    // for both a fresh insert and that duplicate branch, so there is no way to
    // tell them apart. Catching ER_DUP_ENTRY is unambiguous.
    const [result] = await db.query<ResultSetHeader>(
      `INSERT INTO job_runs
         (job_type, dedupe_key, trigger_source, requested_by, params_json,
          artifact_key, max_attempts)
       VALUES (?, ?, ?, ?, CAST(? AS JSON), ?, ?)`,
      values
    )
    return { jobRunId: String(result.insertId), created: true }
  } catch (error) {
    const code =
      error && typeof error === "object" && "code" in error
        ? String((error as { code: unknown }).code)
        : ""
    if (code !== "ER_DUP_ENTRY") {
      throw error
    }

    // A non-terminal run already holds this key. Join it.
    const [rows] = await db.query<Array<RowDataPacket & { id: string }>>(
      `SELECT id FROM job_runs
        WHERE job_type = ? AND dedupe_key = ?
        LIMIT 1`,
      [input.jobType, input.dedupeKey]
    )
    const existing = rows[0]?.id
    if (!existing) {
      // It completed between the failed insert and this read, freeing the key.
      // Retrying once is correct: there is now nothing to join.
      const [retry] = await db.query<ResultSetHeader>(
        `INSERT INTO job_runs
           (job_type, dedupe_key, trigger_source, requested_by, params_json,
            artifact_key, max_attempts)
         VALUES (?, ?, ?, ?, CAST(? AS JSON), ?, ?)`,
        values
      )
      return { jobRunId: String(retry.insertId), created: true }
    }
    return { jobRunId: String(existing), created: false }
  }
}

/**
 * Reclaim runs whose lease lapsed, and terminate the ones out of attempts.
 *
 * Terminating matters as much as reclaiming: it frees the dedupe key AND gives
 * a polling client a terminal status, so a stranded run can no longer spin a
 * browser forever.
 */
export async function expireStaleLeases(
  db: Queryable
): Promise<{ reclaimed: number; abandoned: number }> {
  const [reclaimed] = await db.query<ResultSetHeader>(
    `UPDATE job_runs
        SET status = 'queued',
            lease_owner = NULL,
            lease_expires_at = NULL,
            heartbeat_at = NULL,
            available_at = DATE_ADD(NOW(3), INTERVAL ? SECOND),
            error_message = CONCAT('Lease expired on attempt ', attempt, '.')
      WHERE status = 'running'
        AND lease_expires_at IS NOT NULL
        AND lease_expires_at < NOW(3)
        AND attempt < max_attempts`,
    [reclaimBackoffSeconds(1)]
  )

  const [abandoned] = await db.query<ResultSetHeader>(
    `UPDATE job_runs
        SET status = 'failed',
            dedupe_key = NULL,
            lease_owner = NULL,
            lease_expires_at = NULL,
            finished_at = NOW(3),
            error_message = CONCAT('Abandoned after ', attempt, ' attempt(s); lease expired.')
      WHERE status = 'running'
        AND lease_expires_at IS NOT NULL
        AND lease_expires_at < NOW(3)
        AND attempt >= max_attempts`
  )

  return {
    reclaimed: reclaimed.affectedRows,
    abandoned: abandoned.affectedRows,
  }
}

/** Claim the oldest eligible run of `jobType`, or null when there is none. */
export async function claimNextJobRun(
  db: Queryable,
  jobType: string,
  leaseSeconds: number = computeLeaseSeconds()
): Promise<JobClaim | null> {
  const [candidates] = await db.query<Array<RowDataPacket & { id: string }>>(
    `SELECT id FROM job_runs
      WHERE job_type = ? AND status = 'queued' AND available_at <= NOW(3)
      ORDER BY id ASC
      LIMIT 1`,
    [jobType]
  )
  const id = candidates[0]?.id
  if (!id) {
    return null
  }

  // Conditional UPDATE rather than SELECT ... FOR UPDATE: it is atomic on its
  // own, and a row lock held for the whole slice would block the reaper.
  const [claimed] = await db.query<ResultSetHeader>(
    `UPDATE job_runs
        SET status = 'running',
            lease_owner = ?,
            lease_expires_at = DATE_ADD(NOW(3), INTERVAL ? SECOND),
            heartbeat_at = NOW(3),
            started_at = COALESCE(started_at, NOW(3)),
            attempt = attempt + 1
      WHERE id = ? AND status = 'queued' AND available_at <= NOW(3)`,
    [LEASE_OWNER, leaseSeconds, id]
  )
  if (claimed.affectedRows !== 1) {
    // Another process won the race. status always changes on a real claim, so
    // MySQL's changed-rows semantics cannot mask a successful one.
    return null
  }

  const [rows] = await db.query<JobRunRow[]>(
    `SELECT id, job_type, attempt, params_json, cursor_json,
            artifact_key, artifact_fingerprint
       FROM job_runs WHERE id = ? LIMIT 1`,
    [id]
  )
  const row = rows[0]
  if (!row) {
    return null
  }

  return {
    id: String(row.id),
    jobType: row.job_type,
    attempt: row.attempt,
    params: row.params_json,
    cursor: row.cursor_json,
    artifactKey: row.artifact_key,
    artifactFingerprint: row.artifact_fingerprint,
  }
}

/**
 * Advance the cursor, write bounded progress, and renew the lease — one
 * statement doing all three, plus acting as the fencing token.
 *
 * Returns false when the lease was stolen (the run was reaped mid-slice). The
 * caller MUST abort immediately without further external side effects: the run
 * now belongs to someone else, and continuing would double-apply its work.
 */
export async function checkpointJobRun(
  db: Queryable,
  input: {
    jobRunId: string
    cursor: unknown
    progress: JobProgress
    processedUnits: number
    totalUnits?: number | null
    leaseSeconds?: number
  }
): Promise<boolean> {
  const [result] = await db.query<ResultSetHeader>(
    `UPDATE job_runs
        SET cursor_json = CAST(? AS JSON),
            progress_json = CAST(? AS JSON),
            processed_units = ?,
            total_units = COALESCE(?, total_units),
            heartbeat_at = NOW(3),
            lease_expires_at = DATE_ADD(NOW(3), INTERVAL ? SECOND)
      WHERE id = ? AND lease_owner = ? AND status = 'running'`,
    [
      JSON.stringify(input.cursor ?? null),
      JSON.stringify(input.progress),
      input.processedUnits,
      input.totalUnits ?? null,
      input.leaseSeconds ?? computeLeaseSeconds(),
      input.jobRunId,
      LEASE_OWNER,
    ]
  )
  return result.affectedRows === 1
}

/**
 * Hand the run back after a slice hit its wall-clock budget.
 *
 * `attempt` is decremented: a voluntary yield is not a failure and must not
 * burn the retry budget. Only reaper reclaims and hard throws consume attempts.
 */
export async function yieldJobRun(
  db: Queryable,
  jobRunId: string
): Promise<void> {
  await db.query(
    `UPDATE job_runs
        SET status = 'queued',
            lease_owner = NULL,
            lease_expires_at = NULL,
            available_at = NOW(3),
            attempt = GREATEST(attempt - 1, 0)
      WHERE id = ? AND lease_owner = ? AND status = 'running'`,
    [jobRunId, LEASE_OWNER]
  )
}

export async function completeJobRun(
  db: Queryable,
  input: {
    jobRunId: string
    status: Extract<JobStatus, "succeeded" | "failed" | "cancelled">
    progress: JobProgress
    errorMessage?: string | null
  }
): Promise<void> {
  // dedupe_key = NULL is what releases the single-flight guard for the next run.
  await db.query(
    `UPDATE job_runs
        SET status = ?,
            dedupe_key = NULL,
            lease_owner = NULL,
            lease_expires_at = NULL,
            progress_json = CAST(? AS JSON),
            error_message = ?,
            finished_at = NOW(3)
      WHERE id = ? AND lease_owner = ?`,
    [
      input.status,
      JSON.stringify(input.progress),
      input.errorMessage ?? null,
      input.jobRunId,
      LEASE_OWNER,
    ]
  )
}

/** Exposed for tests and diagnostics; never used to make decisions. */
export function currentLeaseOwner(): string {
  return LEASE_OWNER
}
