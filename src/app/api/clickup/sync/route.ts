import { NextRequest, NextResponse } from "next/server"

import { serverError } from "@/lib/api-errors"
import { resolveApiUser } from "@/lib/api-auth"
import { withRequestContext } from "@/lib/api-request-context"
import { resolveActorLabel } from "@/lib/clickup-ticket-sync"
import { isCronSecretAuthorized } from "@/lib/cron-auth"
import getPool from "@/lib/db"
import { CLICKUP_SYNC_JOB_TYPE } from "@/lib/job-handlers/clickup-sync"
import { enqueueJobRun } from "@/lib/job-runner"
import { driveJobType } from "@/lib/job-tick"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

/**
 * POST /api/clickup/sync — enqueue a full ClickUp status sync.
 *
 * Previously this walked every linked ticket inside the request, making one
 * un-timed ClickUp call per ticket, with nothing preventing two runs from
 * overlapping. It now enqueues a durable job and drives one bounded slice
 * inline so the caller gets immediate progress; the cron tick carries the rest.
 *
 * The dedupe key is a constant, so the UNIQUE index on job_runs makes a second
 * request join the run already in flight instead of starting a rival one.
 */
export const POST = withRequestContext("/api/clickup/sync", handlePost)

async function handlePost(request: NextRequest): Promise<Response> {
  const cronAllowed = isCronSecretAuthorized(
    request,
    process.env.CLICKUP_SYNC_CRON_SECRET
  )

  let actorLabel = "ClickUp Cron Sync"
  let requestedBy: string | null = null

  if (!cronAllowed) {
    // A manual full sync touches every linked ticket, so require the
    // /clickup-tasks key plus the Admin role.
    const auth = await resolveApiUser(request, {
      allowedPaths: ["/clickup-tasks"],
      requireRole: "Admin",
    })
    if ("response" in auth) {
      return auth.response
    }
    actorLabel = await resolveActorLabel(auth.user.id)
    requestedBy = auth.user.id
  }

  let enqueued: { jobRunId: string; created: boolean }
  try {
    enqueued = await enqueueJobRun(getPool(), {
      jobType: CLICKUP_SYNC_JOB_TYPE,
      dedupeKey: "singleton",
      triggerSource: cronAllowed ? "cron" : "manual",
      requestedBy,
      params: { actorLabel },
    })
  } catch (error) {
    return serverError("clickup/sync", error, "Failed to run ClickUp status sync.")
  }

  // Once enqueued, the sync is accepted whatever the inline slice does. A slice
  // that throws has already recorded its error on the run and will be retried
  // by the tick, so answering 500 here would report a failure for a sync that
  // is in fact still queued.
  let slice: Awaited<ReturnType<typeof driveJobType>> = null
  let sliceFailed = false
  try {
    slice = await driveJobType(CLICKUP_SYNC_JOB_TYPE)
  } catch {
    // Logged with full context inside driveJobType.
    sliceFailed = true
  }

  return NextResponse.json(
    {
      jobRunId: enqueued.jobRunId,
      // false means a run was already in flight and this request joined it.
      created: enqueued.created,
      // null when another process holds the lock; the tick will pick it up.
      slice: slice ?? null,
      sliceFailed,
    },
    { status: 202 }
  )
}
