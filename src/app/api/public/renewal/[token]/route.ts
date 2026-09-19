import { NextRequest, NextResponse } from "next/server"

import { serverError } from "@/lib/api-errors"
import { withRequestContext } from "@/lib/api-request-context"
import { markOpened, recordLinkEvent } from "@/lib/renewal/public-invoice"

import { guardPublicRequest, viewFor } from "./helpers"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

type RouteContext = { params: Promise<{ token: string }> }

/**
 * GET — the invoice as the merchant sees it.
 *
 * Records an open unless the caller is signed-in staff, whose visits would
 * otherwise inflate the engagement figures the analytics are built on.
 * Reading is otherwise side-effect free, so a link preview crawler cannot
 * change anything.
 */
export const GET = withRequestContext("/api/public/renewal/[token]", handleGet as never)

async function handleGet(request: NextRequest, context: RouteContext): Promise<Response> {
  const { token } = await context.params
  const guard = await guardPublicRequest(request, token, "read")
  if (!guard.ok) {
    return guard.response
  }
  const { loaded, ip, userAgent, isStaff } = guard.context

  try {
    if (!isStaff) {
      await Promise.all([
        markOpened(loaded.invoice.id),
        recordLinkEvent(loaded.invoice.id, "opened", { ip, userAgent }),
      ])
    }
    return NextResponse.json(await viewFor(loaded), {
      headers: { "Cache-Control": "private, no-store" },
    })
  } catch (error) {
    return serverError("public/renewal/[token]", error, "Unable to load this renewal.")
  }
}
