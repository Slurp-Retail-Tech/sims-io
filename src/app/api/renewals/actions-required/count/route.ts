import { NextRequest, NextResponse } from "next/server"

import { resolveApiUser } from "@/lib/api-auth"
import { serverError } from "@/lib/api-errors"
import { withRequestContext } from "@/lib/api-request-context"
import { countOpenBlockingActions } from "@/lib/renewal/actions-required"

import { ACTIONS_MANAGE_PATH, ACTIONS_VIEW_PATH } from "../helpers"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

/**
 * GET — how many open entries block an invoice, for the sidebar badge.
 *
 * One COUNT against an indexed column, so it is cheap enough to ask on every
 * navigation. Blocking only: informational entries are worth reading but do
 * not need someone to act before tonight's run.
 */
export const GET = withRequestContext("/api/renewals/actions-required/count", handleGet)

async function handleGet(request: NextRequest): Promise<Response> {
  const auth = await resolveApiUser(request, {
    allowedPaths: [ACTIONS_VIEW_PATH, ACTIONS_MANAGE_PATH],
  })
  if ("response" in auth) {
    return auth.response
  }
  try {
    return NextResponse.json(
      { blocking: await countOpenBlockingActions() },
      { headers: { "Cache-Control": "private, no-store" } }
    )
  } catch (error) {
    return serverError("renewals/actions-required/count", error, "Unable to count the queue.")
  }
}
