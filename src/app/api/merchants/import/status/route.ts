import { NextRequest, NextResponse } from "next/server"

import { requireAuthenticatedUser } from "@/lib/auth"
import getPool from "@/lib/db"
import { MERCHANT_IMPORT_JOB_TYPE } from "@/lib/job-handlers/merchant-import"

type JobRunRow = {
  id: string
  status: "queued" | "running" | "succeeded" | "failed" | "cancelled"
  started_at: string | null
  finished_at: string | null
  processed_units: number
  error_message: string | null
}

type LegacyRunRow = {
  id: string
  status: "running" | "success" | "failed"
  started_at: string
  completed_at: string | null
  records_imported: number
  error_message: string | null
}

/** Legacy statuses mapped onto the runner's vocabulary so the UI sees one shape. */
const LEGACY_STATUS: Record<LegacyRunRow["status"], JobRunRow["status"]> = {
  running: "running",
  success: "succeeded",
  failed: "failed",
}

export async function GET(request: NextRequest) {
  const user = await requireAuthenticatedUser(request)
  if (!user) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 })
  }

  const pool = getPool()
  const [jobRows] = await pool.query(
    `
    SELECT id, status, started_at, finished_at, processed_units, error_message
    FROM job_runs
    WHERE job_type = ?
    ORDER BY id DESC
    LIMIT 1
  `,
    [MERCHANT_IMPORT_JOB_TYPE]
  )

  const job = (jobRows as JobRunRow[])[0]
  if (job) {
    return NextResponse.json({
      run: {
        id: job.id,
        status: job.status,
        startedAt: job.started_at,
        completedAt: job.finished_at,
        recordsImported: job.processed_units,
        errorMessage: job.error_message,
      },
    })
  }

  // Falls back to the pre-runner table so the "last import" widget does not
  // blank out at cutover, before the first job-runner import has happened.
  const [legacyRows] = await pool.query(
    `
    SELECT id, status, started_at, completed_at, records_imported, error_message
    FROM merchant_import_runs
    ORDER BY started_at DESC
    LIMIT 1
  `
  )

  const legacy = (legacyRows as LegacyRunRow[])[0]
  if (!legacy) {
    return NextResponse.json({ run: null })
  }

  return NextResponse.json({
    run: {
      id: legacy.id,
      status: LEGACY_STATUS[legacy.status],
      startedAt: legacy.started_at,
      completedAt: legacy.completed_at,
      recordsImported: legacy.records_imported,
      errorMessage: legacy.error_message,
    },
  })
}
