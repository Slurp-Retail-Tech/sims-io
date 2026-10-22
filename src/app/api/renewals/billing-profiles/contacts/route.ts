import { NextRequest, NextResponse } from "next/server"

import { resolveApiUser } from "@/lib/api-auth"
import { serverError } from "@/lib/api-errors"
import { withRequestContext } from "@/lib/api-request-context"
import { searchBukkuContacts } from "@/lib/renewal/billing-profiles"

import { BILLING_PROFILES_MANAGE_PATH } from "../helpers"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

/** GET `?q=` — imported Bukku contacts by code, name or registration number, for the picker. */
export const GET = withRequestContext("/api/renewals/billing-profiles/contacts", handleGet)

async function handleGet(request: NextRequest): Promise<Response> {
  const auth = await resolveApiUser(request, { allowedPaths: [BILLING_PROFILES_MANAGE_PATH] })
  if ("response" in auth) {
    return auth.response
  }
  const query = new URL(request.url).searchParams.get("q")?.trim() ?? ""
  if (query.length < 2) {
    return NextResponse.json({ contacts: [] })
  }
  try {
    return NextResponse.json({ contacts: await searchBukkuContacts(query.slice(0, 80)) })
  } catch (error) {
    return serverError("renewals/billing-profiles/contacts", error, "Unable to search the contacts.")
  }
}
