import { NextRequest, NextResponse } from "next/server"

import { resolveApiUser } from "@/lib/api-auth"
import { notFound, serverError } from "@/lib/api-errors"
import { withRequestContext } from "@/lib/api-request-context"
import { dismissAction } from "@/lib/renewal/actions-required"

import { ACTIONS_MANAGE_PATH } from "../helpers"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

type RouteContext = { params: Promise<{ actionId: string }> }

/**
 * PATCH — dismiss an entry with a reason.
 *
 * Dismissal is for an entry that is genuinely not a problem, and it is
 * deliberately separate from resolution: an entry whose underlying gap is
 * fixed closes itself on the next nightly run, with no action needed here.
 * Requiring a reason keeps the two apart in the record.
 */
export const PATCH = withRequestContext(
  "/api/renewals/actions-required/[actionId]",
  handlePatch as never
)

async function handlePatch(
  request: NextRequest,
  context: RouteContext
): Promise<Response> {
  const auth = await resolveApiUser(request, {
    allowedPaths: [ACTIONS_MANAGE_PATH],
  })
  if ("response" in auth) {
    return auth.response
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 })
  }

  const reason = (body as { reason?: unknown }).reason
  if (typeof reason !== "string" || !reason.trim()) {
    return NextResponse.json(
      {
        error: "Say why this is being dismissed, so the record explains itself.",
      },
      { status: 422 }
    )
  }

  try {
    const { actionId } = await context.params
    const dismissed = await dismissAction(actionId, reason.trim(), auth.user.id)
    if (!dismissed) {
      return notFound("No open entry here.")
    }
    return NextResponse.json({ actionId, dismissed: true })
  } catch (error) {
    return serverError(
      "renewals/actions-required/[actionId]",
      error,
      "Unable to dismiss the entry."
    )
  }
}
