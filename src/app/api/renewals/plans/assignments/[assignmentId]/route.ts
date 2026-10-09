import { NextRequest, NextResponse } from "next/server"

import { notFound, serverError } from "@/lib/api-errors"
import { withRequestContext } from "@/lib/api-request-context"
import {
  deactivateAssignment,
  decideAssignmentOverride,
} from "@/lib/renewal/plans"

import { resolvePlansApprover, resolvePlansManager } from "../../helpers"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

type RouteContext = { params: Promise<{ assignmentId: string }> }

/**
 * PATCH /api/renewals/plans/assignments/[assignmentId] — approve or reject an
 * override.
 *
 * Requires the approve key, which the manage key deliberately does not imply:
 * a control the same person can both trip and clear is not a control.
 */
export const PATCH = withRequestContext(
  "/api/renewals/plans/assignments/[assignmentId]",
  handlePatch as never
)

async function handlePatch(
  request: NextRequest,
  context: RouteContext
): Promise<Response> {
  const auth = await resolvePlansApprover(request)
  if ("response" in auth) {
    return auth.response
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 })
  }

  const decision = (body as { decision?: unknown }).decision
  if (decision !== "approved" && decision !== "rejected") {
    return NextResponse.json(
      { error: "Decision must be approved or rejected." },
      { status: 422 }
    )
  }

  try {
    const { assignmentId } = await context.params
    const applied = await decideAssignmentOverride(
      assignmentId,
      decision,
      auth.user.id
    )
    if (!applied) {
      // Either it does not exist or somebody already decided it. Both read the
      // same to a caller who cannot see the row, which is the point.
      return notFound("No override is waiting on a decision here.")
    }
    return NextResponse.json({ assignmentId, decision })
  } catch (error) {
    return serverError(
      "renewals/plans/assignments/[assignmentId]",
      error,
      "Unable to record the decision."
    )
  }
}

/**
 * DELETE — end an assignment without replacing it.
 *
 * The covered outlets then fall back a scope: an outlet-scope assignment
 * removed leaves the franchise-wide one in force, and removing that leaves no
 * plan, which the nightly run reports as `no_plan_assigned`.
 */
export const DELETE = withRequestContext(
  "/api/renewals/plans/assignments/[assignmentId]",
  handleDelete as never
)

async function handleDelete(
  request: NextRequest,
  context: RouteContext
): Promise<Response> {
  const auth = await resolvePlansManager(request)
  if ("response" in auth) {
    return auth.response
  }

  try {
    const { assignmentId } = await context.params
    const removed = await deactivateAssignment(assignmentId)
    if (!removed) {
      return notFound("Assignment not found.")
    }
    return NextResponse.json({ assignmentId, deactivated: true })
  } catch (error) {
    return serverError(
      "renewals/plans/assignments/[assignmentId]",
      error,
      "Unable to remove the assignment."
    )
  }
}
