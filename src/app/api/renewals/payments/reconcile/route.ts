import { NextRequest, NextResponse } from "next/server"

import { resolveApiUser } from "@/lib/api-auth"
import { serverError } from "@/lib/api-errors"
import { withRequestContext } from "@/lib/api-request-context"
import { isCronSecretAuthorized } from "@/lib/cron-auth"
import getPool from "@/lib/db"
import { RENEWAL_PAYMENT_RECONCILE_JOB_TYPE } from "@/lib/job-handlers/renewal-payment-reconcile"
import { enqueueJobRun } from "@/lib/job-runner"
import { driveJobType } from "@/lib/job-tick"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

/**
 * POST /api/renewals/payments/reconcile — the hourly payment sweep.
 *
 * Queries CommercePay for every open payment session, settles any that paid
 * without a callback arriving, closes the ones that failed or expired, and
 * re-queues post-payment steps still outstanding on paid invoices.
 *
 * Safe to run repeatedly: a settled payment is recognised as a duplicate, and
 * the job is keyed so a second call joins the run already in flight.
 */
export const POST = withRequestContext("/api/renewals/payments/reconcile", handlePost)

async function handlePost(request: NextRequest): Promise<Response> {
  const cronAllowed = isCronSecretAuthorized(request, process.env.RENEWAL_PAYMENT_RECONCILE_CRON_SECRET)

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
      jobType: RENEWAL_PAYMENT_RECONCILE_JOB_TYPE,
      dedupeKey: "singleton",
      triggerSource: cronAllowed ? "cron" : "manual",
      requestedBy,
    })
    const slice = await driveJobType(RENEWAL_PAYMENT_RECONCILE_JOB_TYPE)
    return NextResponse.json({ jobRunId, created, slice: slice ?? null }, { status: 202 })
  } catch (error) {
    return serverError("renewals/payments/reconcile", error, "Payment reconcile failed. Check server logs.")
  }
}
