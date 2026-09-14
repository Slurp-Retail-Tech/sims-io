import { NextRequest, NextResponse } from "next/server"

import { resolveApiUser } from "@/lib/api-auth"
import { serverError } from "@/lib/api-errors"
import { PLUS_IMPORT_JOB_TYPE } from "@/lib/job-handlers/plus-import"
import { driveJobType } from "@/lib/job-tick"
import { getPlusUpdateJob } from "@/lib/plus-import"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

/**
 * POST /api/plus/update/:jobId/start — advance the run by one slice.
 *
 * Idempotent, and safe to call on a loop: it takes the job type's advisory lock
 * and returns immediately if another caller (or the cron tick) already holds
 * it. That is what lets the page drive its own job at sub-second latency while
 * the tick remains the safety net for a closed tab.
 *
 * It replaces a fire-and-forget `void runPlusUpdateJob(...)`, which detached
 * the work from any supervision — a deploy mid-run left the row marked running
 * forever with nothing to notice or resume it.
 */
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ jobId: string }> }
) {
  const auth = await resolveApiUser(request, { allowedPaths: ["/plus"] })
  if ("response" in auth) {
    return auth.response
  }

  const { jobId } = await context.params
  const job = await getPlusUpdateJob(jobId)
  if (!job) {
    return NextResponse.json({ error: "Job not found." }, { status: 404 })
  }
  if (job.finishedAt) {
    return NextResponse.json({ ok: true, alreadyFinished: true })
  }

  try {
    const slice = await driveJobType(PLUS_IMPORT_JOB_TYPE)
    return NextResponse.json({
      ok: true,
      // null when another slice or the tick holds the lock; the caller simply
      // polls again rather than treating it as an error.
      claimed: Boolean(slice),
      slice: slice ?? null,
    })
  } catch (error) {
    return serverError("plus/update/start", error, "Unable to advance the PLUS update.")
  }
}
