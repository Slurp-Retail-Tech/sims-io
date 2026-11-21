import { NextRequest, NextResponse } from "next/server"

import { resolveApiUser } from "@/lib/api-auth"
import { serverError } from "@/lib/api-errors"
import { withRequestContext } from "@/lib/api-request-context"
import { listBillingProfiles } from "@/lib/renewal/billing-profiles"

import { BILLING_PROFILES_MANAGE_PATH, BILLING_PROFILES_VIEW_PATH } from "./helpers"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

/** GET — every renewal franchise with its billing profile, or its candidate Bukku contacts. */
export const GET = withRequestContext("/api/renewals/billing-profiles", handleGet)

async function handleGet(request: NextRequest): Promise<Response> {
  const auth = await resolveApiUser(request, {
    allowedPaths: [BILLING_PROFILES_VIEW_PATH, BILLING_PROFILES_MANAGE_PATH],
  })
  if ("response" in auth) {
    return auth.response
  }
  try {
    return NextResponse.json(await listBillingProfiles())
  } catch (error) {
    return serverError("renewals/billing-profiles", error, "Unable to load the billing profiles.")
  }
}
