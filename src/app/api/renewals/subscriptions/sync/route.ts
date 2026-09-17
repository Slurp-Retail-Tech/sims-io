import { NextRequest, NextResponse } from "next/server"

import { resolveApiUser } from "@/lib/api-auth"
import { serverError } from "@/lib/api-errors"
import { withRequestContext } from "@/lib/api-request-context"
import { isCronSecretAuthorized } from "@/lib/cron-auth"
import getPool from "@/lib/db"
import { RENEWAL_SUBSCRIPTION_SYNC_JOB_TYPE } from "@/lib/job-handlers/renewal-subscription-sync"
import { enqueueJobRun } from "@/lib/job-runner"
import { driveJobType } from "@/lib/job-tick"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

/**
 * POST /api/renewals/subscriptions/sync — project POS outlets into
 * `outlet_subscriptions`.
 *
 * Scheduled to run after the merchant import each night, because the
 * projection reads what that import just wrote. Enqueues a durable job and
 * drives one bounded slice inline; the tick carries the rest and resumes from
 * the keyset cursor if a deploy interrupts it.
 *
 * The work is idempotent — every write is an upsert keyed on
 * (franchise_id, outlet_id) — so a duplicate call costs time and nothing else.
 * `dedupeKey` still makes a second caller join the run already in flight
 * rather than start a rival one.
 */
export const POST = withRequestContext(
  "/api/renewals/subscriptions/sync",
  handlePost
)

async function handlePost(request: NextRequest): Promise<Response> {
  const cronAllowed = isCronSecretAuthorized(
    request,
    process.env.RENEWAL_SUBSCRIPTION_SYNC_CRON_SECRET
  )

  let requestedBy: string | null = null

  if (!cronAllowed) {
    // The manual path is for re-seeding after a data fix, which touches every
    // subscription row, so it needs the module key plus the Admin role.
    const auth = await resolveApiUser(request, {
      allowedPaths: ["/renewal-retention/renewal-due"],
      requireRole: "Admin",
    })
    if ("response" in auth) {
      return auth.response
    }
    requestedBy = auth.user.id
  }

  try {
    const { jobRunId, created } = await enqueueJobRun(getPool(), {
      jobType: RENEWAL_SUBSCRIPTION_SYNC_JOB_TYPE,
      dedupeKey: "singleton",
      triggerSource: cronAllowed ? "cron" : "manual",
      requestedBy,
    })

    const slice = await driveJobType(RENEWAL_SUBSCRIPTION_SYNC_JOB_TYPE)

    return NextResponse.json(
      { jobRunId, created, slice: slice ?? null },
      { status: 202 }
    )
  } catch (error) {
    return serverError(
      "renewals/subscriptions/sync",
      error,
      "Subscription sync failed. Check server logs."
    )
  }
}
