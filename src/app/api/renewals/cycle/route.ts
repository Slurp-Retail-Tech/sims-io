import { NextRequest, NextResponse } from "next/server"

import { resolveApiUser } from "@/lib/api-auth"
import { serverError } from "@/lib/api-errors"
import { withRequestContext } from "@/lib/api-request-context"
import { isCronSecretAuthorized } from "@/lib/cron-auth"
import getPool from "@/lib/db"
import { RENEWAL_CYCLE_JOB_TYPE } from "@/lib/job-handlers/renewal-cycle"
import { enqueueJobRun } from "@/lib/job-runner"
import { driveJobType } from "@/lib/job-tick"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

/**
 * POST /api/renewals/cycle — the nightly renewal detection run.
 *
 * Finds subscriptions expiring inside the invoicing window, which runs from
 * the furthest configured reminder offset down to the expiry date itself,
 * raises or reuses their proforma, and writes the specific reason for every
 * one it could not invoice.
 *
 * Schedule it after the subscription sync, which is itself after the merchants
 * import: each reads what the previous one wrote.
 *
 * Safe to run repeatedly. Invoice generation races against a unique index
 * rather than checking first, so a second run reuses what the first created,
 * and Actions Required entries are upserted rather than duplicated.
 */
export const POST = withRequestContext("/api/renewals/cycle", handlePost)

async function handlePost(request: NextRequest): Promise<Response> {
  const cronAllowed = isCronSecretAuthorized(
    request,
    process.env.RENEWAL_CYCLE_CRON_SECRET
  )

  let requestedBy: string | null = null

  if (!cronAllowed) {
    // The manual path exists for re-running a night that failed, which can
    // raise invoices across every franchise, so it needs the invoices key plus
    // the Admin role.
    const auth = await resolveApiUser(request, {
      allowedPaths: ["/renewal-retention/invoices"],
      requireRole: "Admin",
    })
    if ("response" in auth) {
      return auth.response
    }
    requestedBy = auth.user.id
  }

  try {
    const { jobRunId, created } = await enqueueJobRun(getPool(), {
      jobType: RENEWAL_CYCLE_JOB_TYPE,
      dedupeKey: "singleton",
      triggerSource: cronAllowed ? "cron" : "manual",
      requestedBy,
    })

    const slice = await driveJobType(RENEWAL_CYCLE_JOB_TYPE)

    return NextResponse.json(
      { jobRunId, created, slice: slice ?? null },
      { status: 202 }
    )
  } catch (error) {
    return serverError(
      "renewals/cycle",
      error,
      "Renewal cycle failed. Check server logs."
    )
  }
}
