import { NextRequest, NextResponse } from "next/server"

import { resolveApiUser } from "@/lib/api-auth"
import { serverError } from "@/lib/api-errors"
import { withRequestContext } from "@/lib/api-request-context"
import { loadOverview } from "@/lib/renewal/overview-data"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

/** GET — the overview figures, computed from live rows. */
export const GET = withRequestContext("/api/renewals/overview", handleGet)

async function handleGet(request: NextRequest): Promise<Response> {
  const auth = await resolveApiUser(request, {
    allowedPaths: ["/renewal-retention/overview", "/renewal-retention"],
  })
  if ("response" in auth) {
    return auth.response
  }
  try {
    return NextResponse.json(await loadOverview(), {
      headers: { "Cache-Control": "private, no-store" },
    })
  } catch (error) {
    return serverError("renewals/overview", error, "Unable to load the overview.")
  }
}
