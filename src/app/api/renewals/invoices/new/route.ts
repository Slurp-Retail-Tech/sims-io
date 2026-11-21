import { NextRequest, NextResponse } from "next/server"

import { resolveApiUser } from "@/lib/api-auth"
import { notFound, serverError } from "@/lib/api-errors"
import { withRequestContext } from "@/lib/api-request-context"
import { loadManualFranchise, searchRenewalFranchises } from "@/lib/renewal/manual-renewal-data"

import { INVOICES_MANAGE_PATH } from "../helpers"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

/**
 * GET — what the New renewal dialog needs. `?q=` searches franchises;
 * `?franchiseId=` returns its outlets with their price per term and whether
 * each can go on a document now. Needs the invoices manage key.
 */
export const GET = withRequestContext("/api/renewals/invoices/new", handleGet)

async function handleGet(request: NextRequest): Promise<Response> {
  const auth = await resolveApiUser(request, { allowedPaths: [INVOICES_MANAGE_PATH] })
  if ("response" in auth) {
    return auth.response
  }
  const params = new URL(request.url).searchParams
  try {
    const franchiseId = params.get("franchiseId")?.trim()
    if (franchiseId) {
      const franchise = await loadManualFranchise(franchiseId.slice(0, 120))
      return franchise ? NextResponse.json({ franchise }) : notFound("No live subscriptions under that franchise.")
    }
    const query = params.get("q")?.trim() ?? ""
    return NextResponse.json({ franchises: query.length >= 2 ? await searchRenewalFranchises(query.slice(0, 80)) : [] })
  } catch (error) {
    return serverError("renewals/invoices/new", error, "Unable to load the franchise.")
  }
}
