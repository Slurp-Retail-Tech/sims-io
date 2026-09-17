import { NextRequest, NextResponse } from "next/server"

import { resolveApiUser } from "@/lib/api-auth"
import { serverError } from "@/lib/api-errors"
import { withRequestContext } from "@/lib/api-request-context"
import {
  countOpenBlockingActions,
  listOpenActions,
} from "@/lib/renewal/actions-required"
import type { ActionReason } from "@/lib/renewal/actions-required"

import { ACTIONS_MANAGE_PATH, ACTIONS_VIEW_PATH } from "./helpers"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

/** GET — the open queue, most urgent first. */
export const GET = withRequestContext(
  "/api/renewals/actions-required",
  handleGet
)

async function handleGet(request: NextRequest): Promise<Response> {
  const auth = await resolveApiUser(request, {
    allowedPaths: [ACTIONS_VIEW_PATH, ACTIONS_MANAGE_PATH],
  })
  if ("response" in auth) {
    return auth.response
  }

  try {
    const { searchParams } = new URL(request.url)
    const reason = searchParams.get("reason")

    const [actions, blockingCount] = await Promise.all([
      listOpenActions({
        reason: (reason as ActionReason) || undefined,
        franchiseId: searchParams.get("fid") ?? undefined,
      }),
      countOpenBlockingActions(),
    ])

    return NextResponse.json({ actions, blockingCount })
  } catch (error) {
    return serverError(
      "renewals/actions-required",
      error,
      "Unable to load the queue."
    )
  }
}
