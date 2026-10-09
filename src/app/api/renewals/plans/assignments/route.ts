import { NextRequest, NextResponse } from "next/server"

import { serverError } from "@/lib/api-errors"
import { withRequestContext } from "@/lib/api-request-context"
import {
  createAssignment,
  listAssignments,
  listPendingOverrides,
} from "@/lib/renewal/plans"
import { validateAssignmentInput } from "@/lib/renewal/plan-validation"
import { loadRenewalSettings } from "@/lib/renewal/settings"

import {
  resolvePlansManager,
  resolvePlansViewer,
  validationFailed,
} from "../helpers"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

/**
 * GET /api/renewals/plans/assignments — who is on which plan.
 *
 * `pending=true` narrows to overrides waiting on someone with the approve key,
 * which is the queue the catalog page surfaces.
 */
export const GET = withRequestContext(
  "/api/renewals/plans/assignments",
  handleGet
)

async function handleGet(request: NextRequest): Promise<Response> {
  const auth = await resolvePlansViewer(request)
  if ("response" in auth) {
    return auth.response
  }

  try {
    const { searchParams } = new URL(request.url)

    if (searchParams.get("pending") === "true") {
      return NextResponse.json({ assignments: await listPendingOverrides() })
    }

    const assignments = await listAssignments({
      franchiseId: searchParams.get("fid") ?? undefined,
      planId: searchParams.get("planId") ?? undefined,
      includeSuperseded: searchParams.get("includeSuperseded") === "true",
    })
    return NextResponse.json({ assignments })
  } catch (error) {
    return serverError(
      "renewals/plans/assignments",
      error,
      "Unable to load assignments."
    )
  }
}

/**
 * POST /api/renewals/plans/assignments — assign a plan.
 *
 * Supersedes whatever held the same scope rather than erroring, because
 * changing which plan a franchise is on is the ordinary act, not an exception.
 * The reply says what it replaced and whether the override now needs sign-off,
 * so the UI can say so without a second request.
 */
export const POST = withRequestContext(
  "/api/renewals/plans/assignments",
  handlePost
)

async function handlePost(request: NextRequest): Promise<Response> {
  const auth = await resolvePlansManager(request)
  if ("response" in auth) {
    return auth.response
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 })
  }

  const validation = validateAssignmentInput(body as never)
  if (!validation.ok) {
    return validationFailed(validation.errors)
  }

  try {
    const settings = await loadRenewalSettings()
    const result = await createAssignment(
      validation.value,
      auth.user.id,
      settings.overrideVarianceThresholdPct
    )
    return NextResponse.json(result, { status: 201 })
  } catch (error) {
    return serverError(
      "renewals/plans/assignments",
      error,
      "Unable to save the assignment."
    )
  }
}
