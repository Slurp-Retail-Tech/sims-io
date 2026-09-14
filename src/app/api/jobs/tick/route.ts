import { NextRequest, NextResponse } from "next/server"

import { serverError } from "@/lib/api-errors"
import { withRequestContext } from "@/lib/api-request-context"
import { isCronSecretAuthorized } from "@/lib/cron-auth"
import { runJobTick } from "@/lib/job-tick"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

/**
 * POST /api/jobs/tick — drives the durable job runner.
 *
 * Cron-only: there is deliberately no authenticated path. Someone wanting to
 * run a job enqueues it on that job's own route and the tick picks it up, so
 * this endpoint has exactly one caller and one reason to exist.
 *
 * Returns 404 rather than 401 when the secret is wrong, so its existence is not
 * confirmed to an unauthenticated caller.
 */
export const POST = withRequestContext("/api/jobs/tick", handlePost)

async function handlePost(request: NextRequest): Promise<Response> {
  if (!isCronSecretAuthorized(request, process.env.JOBS_TICK_CRON_SECRET)) {
    return NextResponse.json({ error: "Not found." }, { status: 404 })
  }

  try {
    return NextResponse.json({ result: await runJobTick() })
  } catch (error) {
    return serverError("jobs/tick", error, "Job tick failed.")
  }
}
