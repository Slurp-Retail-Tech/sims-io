import { NextRequest, NextResponse } from "next/server"

import { resolveApiUser } from "@/lib/api-auth"
import { serverError } from "@/lib/api-errors"
import { withRequestContext } from "@/lib/api-request-context"
import { loadAnalytics } from "@/lib/renewal/analytics-data"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

/** GET — the analytics for `?period=YYYY-MM` or `?period=YYYY`. */
export const GET = withRequestContext("/api/renewals/analytics", handleGet)

async function handleGet(request: NextRequest): Promise<Response> {
  const auth = await resolveApiUser(request, {
    allowedPaths: ["/renewal-retention/analytics", "/renewal-retention"],
  })
  if ("response" in auth) {
    return auth.response
  }
  try {
    const period = new URL(request.url).searchParams.get("period")
    return NextResponse.json(await loadAnalytics(period), {
      headers: { "Cache-Control": "private, no-store" },
    })
  } catch (error) {
    return serverError("renewals/analytics", error, "Unable to load the analytics.")
  }
}
