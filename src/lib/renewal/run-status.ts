/**
 * The nightly renewal check's status, for every screen that reports on it.
 *
 * One loader so Overview, Actions Required, Invoices and the setup checklist
 * agree on when the check last ran and whether its silence means anything.
 */

import getPool, { type Queryable } from "../db.ts"
import type { RowDataPacket } from "mysql2/promise"

import { todayInAppZone } from "./app-date.ts"
import { addDays } from "./invoice-build.ts"
import { RENEWAL_CYCLE_JOB_TYPE } from "../job-types.ts"
import type { RunSummary } from "./queue-state.ts"
import { invoiceWindowDays } from "./readiness.ts"
import { loadRenewalSettings } from "./settings.ts"

export type RunStatus = RunSummary & {
  /** Slurp-billed, active subscriptions expiring inside the readiness window. */
  subscriptionsInWindow: number
  readinessWindowDays: number
  /** How many days before expiry a proforma may be raised: the furthest offset. */
  invoiceWindowDays: number
}

export async function loadRunStatus(db: Queryable = getPool()): Promise<RunStatus> {
  const settings = await loadRenewalSettings(db)
  const today = todayInAppZone()
  const windowEnd = addDays(today, Math.max(0, settings.readinessWindowDays))

  const [[lastRows], [okRows], [windowRows]] = await Promise.all([
    db.query<RowDataPacket[]>(
      `SELECT status, finished_at FROM job_runs
        WHERE job_type = ? AND status IN ('succeeded', 'failed')
        ORDER BY id DESC LIMIT 1`,
      [RENEWAL_CYCLE_JOB_TYPE]
    ),
    db.query<RowDataPacket[]>(
      `SELECT finished_at FROM job_runs
        WHERE job_type = ? AND status = 'succeeded'
        ORDER BY id DESC LIMIT 1`,
      [RENEWAL_CYCLE_JOB_TYPE]
    ),
    db.query<RowDataPacket[]>(
      `SELECT COUNT(*) AS n FROM outlet_subscriptions
        WHERE deleted_at IS NULL AND is_active = 1 AND billed_by = 'slurp'
          AND valid_until_date BETWEEN ? AND ?`,
      [today, windowEnd]
    ),
  ])

  const last = lastRows[0] as { status: "succeeded" | "failed"; finished_at: string | null } | undefined
  const ok = okRows[0] as { finished_at: string | null } | undefined
  const inWindow = windowRows[0] as { n: number | string } | undefined

  return {
    lastStatus: last?.status ?? null,
    lastFinishedAt: last?.finished_at ?? null,
    lastSucceededAt: ok?.finished_at ?? null,
    subscriptionsInWindow: Number(inWindow?.n ?? 0),
    readinessWindowDays: settings.readinessWindowDays,
    invoiceWindowDays: invoiceWindowDays(settings.reminderOffsets),
  }
}
