import { NextRequest, NextResponse } from "next/server"

import { resolveApiUser } from "@/lib/api-auth"
import { serverError } from "@/lib/api-errors"
import { withRequestContext } from "@/lib/api-request-context"
import { isCronSecretAuthorized } from "@/lib/cron-auth"
import getPool from "@/lib/db"
import { MERCHANT_IMPORT_JOB_TYPE } from "@/lib/job-handlers/merchant-import"
import { enqueueJobRun } from "@/lib/job-runner"
import { driveJobType } from "@/lib/job-tick"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

/**
 * POST /api/merchants/import — enqueue a full POS merchant import.
 *
 * Previously this awaited the entire paginated import inside the request, which
 * could span dozens of POS round trips and had nothing stopping two runs from
 * interleaving their upserts. It now enqueues a durable job and drives one
 * bounded slice inline; the cron tick carries the rest and resumes from the
 * page cursor if a deploy interrupts it.
 *
 * Callers poll /api/merchants/import/status rather than waiting on this
 * response.
 */
export const POST = withRequestContext("/api/merchants/import", handlePost)

async function handlePost(request: NextRequest): Promise<Response> {
  const cronAllowed = isCronSecretAuthorized(
    request,
    process.env.MERCHANT_IMPORT_CRON_SECRET
  )

  let requestedBy: string | null = null

  if (!cronAllowed) {
    // A full import overwrites the merchant directory, so the manual path
    // requires the /merchants key plus the Admin role.
    const auth = await resolveApiUser(request, {
      allowedPaths: ["/merchants"],
      requireRole: "Admin",
    })
    if ("response" in auth) {
      return auth.response
    }
    requestedBy = auth.user.id
  }

  let enqueued: { jobRunId: string; created: boolean }
  try {
    enqueued = await enqueueJobRun(getPool(), {
      jobType: MERCHANT_IMPORT_JOB_TYPE,
      dedupeKey: "singleton",
      triggerSource: cronAllowed ? "cron" : "manual",
      requestedBy,
    })
  } catch (error) {
    return serverError("merchants/import", error, "Import failed. Check server logs.")
  }

  // Once enqueued, the import is accepted whatever the inline slice does. A
  // slice that throws has already recorded its error on the run and will be
  // retried by the tick, so answering 500 here would tell the user the import
  // failed while it is in fact still queued. The status poll reports it.
  let slice: Awaited<ReturnType<typeof driveJobType>> = null
  let sliceFailed = false
  try {
    slice = await driveJobType(MERCHANT_IMPORT_JOB_TYPE)
  } catch {
    // Logged with full context inside driveJobType.
    sliceFailed = true
  }

  return NextResponse.json(
    { ...enqueued, slice: slice ?? null, sliceFailed },
    { status: 202 }
  )
}
