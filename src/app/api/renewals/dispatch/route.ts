import { NextRequest, NextResponse } from "next/server"

import { resolveApiUser } from "@/lib/api-auth"
import { serverError } from "@/lib/api-errors"
import { withRequestContext } from "@/lib/api-request-context"
import { isCronSecretAuthorized } from "@/lib/cron-auth"
import getPool from "@/lib/db"
import { RENEWAL_DISPATCH_JOB_TYPE } from "@/lib/job-handlers/renewal-dispatch"
import { enqueueJobRun } from "@/lib/job-runner"
import { driveJobType } from "@/lib/job-tick"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

/**
 * POST /api/renewals/dispatch — send the renewal messages that are due.
 *
 * Reminders and receipts are queued by the nightly cycle and by post-payment;
 * the tick sends what is due straight away. This route picks up what falls
 * due later: reminders held for the send window and retries after a failure.
 * Schedule it every 15 minutes.
 *
 * Sends nothing while outbound dispatch is paused in Renewal Settings.
 * Safe to overlap: the job is single-flight and each row is claimed before
 * it is sent.
 */
export const POST = withRequestContext("/api/renewals/dispatch", handlePost)

async function handlePost(request: NextRequest): Promise<Response> {
  const cronAllowed = isCronSecretAuthorized(request, process.env.RENEWAL_DISPATCH_CRON_SECRET)

  let requestedBy: string | null = null
  if (!cronAllowed) {
    const auth = await resolveApiUser(request, {
      allowedPaths: ["/renewal-retention/invoices/manage"],
      requireRole: "Admin",
    })
    if ("response" in auth) {
      return auth.response
    }
    requestedBy = auth.user.id
  }

  try {
    const { jobRunId, created } = await enqueueJobRun(getPool(), {
      jobType: RENEWAL_DISPATCH_JOB_TYPE,
      dedupeKey: "singleton",
      triggerSource: cronAllowed ? "cron" : "manual",
      requestedBy,
    })
    const slice = await driveJobType(RENEWAL_DISPATCH_JOB_TYPE)
    return NextResponse.json({ jobRunId, created, slice: slice ?? null }, { status: 202 })
  } catch (error) {
    return serverError("renewals/dispatch", error, "Renewal dispatch failed. Check server logs.")
  }
}
