import { NextRequest, NextResponse } from "next/server"

import { resolveApiUser } from "@/lib/api-auth"
import { serverError } from "@/lib/api-errors"
import { withRequestContext } from "@/lib/api-request-context"
import {
  countOpenBlockingActions,
  listOpenActions,
} from "@/lib/renewal/actions-required"
import type { ActionReason } from "@/lib/renewal/actions-required"
import { describeQueueState } from "@/lib/renewal/queue-state"
import { loadRunStatus } from "@/lib/renewal/run-status"

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

    const [actions, blockingCount, runStatus] = await Promise.all([
      listOpenActions({
        reason: (reason as ActionReason) || undefined,
        franchiseId: searchParams.get("fid") ?? undefined,
      }),
      countOpenBlockingActions(),
      loadRunStatus(),
    ])

    // Judged against the whole queue, not a filtered view of it: a filter
    // that matches nothing must not make the page claim everything is clear.
    const openCount = reason || searchParams.get("fid") ? (await listOpenActions({})).length : actions.length
    const queueState = describeQueueState({
      run: runStatus,
      openCount,
      subscriptionsInWindow: runStatus.subscriptionsInWindow,
    })

    return NextResponse.json({ actions, blockingCount, runStatus, queueState })
  } catch (error) {
    return serverError(
      "renewals/actions-required",
      error,
      "Unable to load the queue."
    )
  }
}
