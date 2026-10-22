import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"

import { resolveApiUser } from "@/lib/api-auth"
import { errorResponse, notFound, serverError } from "@/lib/api-errors"
import { withRequestContext } from "@/lib/api-request-context"
import { NON_RENEWAL_REASON_VALUES } from "@/lib/renewal/non-renewal"
import { clearNonRenewal, recordNonRenewal } from "@/lib/renewal/non-renewal-data"

import { INVOICES_MANAGE_PATH } from "../invoices/helpers"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

const ID = z.string().trim().min(1).max(120)

const recordSchema = z
  .object({
    franchiseId: ID,
    outletIds: z.array(ID).max(200).default([]),
    invoiceId: z.string().regex(/^\d+$/).nullish().transform((value) => value ?? null),
    reason: z.enum(NON_RENEWAL_REASON_VALUES),
    note: z.string().max(1000).nullish().transform((value) => value ?? null),
  })
  .refine((body) => body.invoiceId !== null || body.outletIds.length > 0, {
    message: "Name the invoice or at least one outlet.",
  })

/**
 * POST — record why outlets are not renewing this cycle. From an invoice,
 * every outlet on it; its document is voided if still open. Needs the
 * invoices manage key, as voiding does.
 */
export const POST = withRequestContext("/api/renewals/non-renewals", handlePost)

async function handlePost(request: NextRequest): Promise<Response> {
  const auth = await resolveApiUser(request, { allowedPaths: [INVOICES_MANAGE_PATH] })
  if ("response" in auth) {
    return auth.response
  }
  let raw: unknown
  try {
    raw = await request.json()
  } catch {
    return errorResponse("Invalid JSON body.", 400)
  }
  const parsed = recordSchema.safeParse(raw)
  if (!parsed.success) {
    return errorResponse(parsed.error.issues[0]?.message ?? "Invalid request.", 400)
  }
  try {
    const outcome = await recordNonRenewal({ ...parsed.data, actorUserId: auth.user.id })
    if (!outcome.ok) {
      return errorResponse(outcome.message, outcome.status)
    }
    return NextResponse.json(outcome)
  } catch (error) {
    return serverError("renewals/non-renewals", error, "Unable to record the reason.")
  }
}

/** DELETE `?franchiseId=&outletId=` — remove a reason recorded against the wrong outlet. */
export const DELETE = withRequestContext("/api/renewals/non-renewals", handleDelete)

async function handleDelete(request: NextRequest): Promise<Response> {
  const auth = await resolveApiUser(request, { allowedPaths: [INVOICES_MANAGE_PATH] })
  if ("response" in auth) {
    return auth.response
  }
  const params = new URL(request.url).searchParams
  const franchiseId = ID.safeParse(params.get("franchiseId"))
  const outletId = ID.safeParse(params.get("outletId"))
  if (!franchiseId.success || !outletId.success) {
    return errorResponse("Name the franchise and outlet.", 400)
  }
  try {
    return (await clearNonRenewal(franchiseId.data, outletId.data))
      ? NextResponse.json({ removed: true })
      : notFound("No reason is recorded for that outlet's current expiry.")
  } catch (error) {
    return serverError("renewals/non-renewals", error, "Unable to remove the reason.")
  }
}
