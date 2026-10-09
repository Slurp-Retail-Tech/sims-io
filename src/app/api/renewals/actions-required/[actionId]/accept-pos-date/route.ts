import { NextRequest, NextResponse } from "next/server"

import { resolveApiUser } from "@/lib/api-auth"
import { serverError } from "@/lib/api-errors"
import { withRequestContext } from "@/lib/api-request-context"
import { acceptPosValidUntil } from "@/lib/renewal/pos-drift-store"

import { SUBSCRIPTIONS_MANAGE_PATH } from "../../helpers"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

type RouteContext = { params: Promise<{ actionId: string }> }

/**
 * POST — take the POS expiry as the SIMS expiry for a "Renewed outside SIMS"
 * entry, and resolve the entry.
 *
 * Needs the subscriptions manage key, because it moves a licence date. Only
 * ever forward; see `decideAcceptPosDate`.
 */
export const POST = withRequestContext(
  "/api/renewals/actions-required/[actionId]/accept-pos-date",
  handlePost as never
)

async function handlePost(request: NextRequest, context: RouteContext): Promise<Response> {
  const auth = await resolveApiUser(request, { allowedPaths: [SUBSCRIPTIONS_MANAGE_PATH] })
  if ("response" in auth) {
    return auth.response
  }

  try {
    const { actionId } = await context.params
    if (!/^\d+$/.test(actionId)) {
      return NextResponse.json({ error: "No open drift entry here." }, { status: 404 })
    }
    const outcome = await acceptPosValidUntil(actionId, auth.user.id)
    if (!outcome.ok) {
      return NextResponse.json({ error: outcome.message }, { status: outcome.status })
    }
    return NextResponse.json({ actionId, validUntil: outcome.validUntil })
  } catch (error) {
    return serverError(
      "renewals/actions-required/[actionId]/accept-pos-date",
      error,
      "Unable to accept the POS date."
    )
  }
}
