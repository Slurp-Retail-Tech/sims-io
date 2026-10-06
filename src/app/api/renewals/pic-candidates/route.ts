import { NextRequest, NextResponse } from "next/server"

import { resolveApiUser } from "@/lib/api-auth"
import { forbidden, serverError } from "@/lib/api-errors"
import { withRequestContext } from "@/lib/api-request-context"
import { evaluateDesignationAccess, SUBSCRIPTIONS_MANAGE_PATH } from "@/lib/renewal/designation-access"
import { buildPicCandidates } from "@/lib/renewal/pic-candidates"
import { loadRenewalDirectory } from "@/lib/renewal/renewal-contacts"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

/**
 * GET /api/renewals/pic-candidates?fid=&oid= — who could be made renewal PIC
 * for an outlet (or, without `oid`, for a whole franchise), with whether each
 * can actually be reached.
 *
 * Gated like the designation it feeds: the renewal subscriptions key AND
 * Contacts, so nobody sees a list they could not act on.
 */
export const GET = withRequestContext("/api/renewals/pic-candidates", handleGet)

async function handleGet(request: NextRequest): Promise<Response> {
  const auth = await resolveApiUser(request, { allowedPaths: [SUBSCRIPTIONS_MANAGE_PATH] })
  if ("response" in auth) {
    return auth.response
  }
  if (!evaluateDesignationAccess(auth.user).allowed) {
    return forbidden("Setting a renewal PIC needs access to Contacts as well.")
  }

  const { searchParams } = new URL(request.url)
  const franchiseId = searchParams.get("fid")?.trim() ?? ""
  const outletId = searchParams.get("oid")?.trim() || null
  if (!franchiseId) {
    return NextResponse.json({ error: "Give the franchise id." }, { status: 400 })
  }

  try {
    const directory = await loadRenewalDirectory(franchiseId)
    return NextResponse.json({ candidates: buildPicCandidates(directory, outletId) })
  } catch (error) {
    return serverError("renewals/pic-candidates", error, "Unable to load the contacts.")
  }
}
