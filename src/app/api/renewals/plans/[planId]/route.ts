import { NextRequest, NextResponse } from "next/server"

import { serverError, notFound } from "@/lib/api-errors"
import { withRequestContext } from "@/lib/api-request-context"
import { getPlan, softDeletePlan, updatePlan } from "@/lib/renewal/plans"
import { validatePlanInput } from "@/lib/renewal/plan-validation"

import {
  resolvePlansManager,
  resolvePlansViewer,
  validationFailed,
} from "../helpers"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

type RouteContext = { params: Promise<{ planId: string }> }

export const GET = withRequestContext(
  "/api/renewals/plans/[planId]",
  handleGet as never
)

async function handleGet(
  request: NextRequest,
  context: RouteContext
): Promise<Response> {
  const auth = await resolvePlansViewer(request)
  if ("response" in auth) {
    return auth.response
  }

  try {
    const { planId } = await context.params
    const plan = await getPlan(planId)
    if (!plan) {
      return notFound("Plan not found.")
    }
    return NextResponse.json({ plan })
  } catch (error) {
    return serverError("renewals/plans/[planId]", error, "Unable to load the plan.")
  }
}

export const PATCH = withRequestContext(
  "/api/renewals/plans/[planId]",
  handlePatch as never
)

async function handlePatch(
  request: NextRequest,
  context: RouteContext
): Promise<Response> {
  const auth = await resolvePlansManager(request)
  if ("response" in auth) {
    return auth.response
  }

  const { planId } = await context.params

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 })
  }

  const validation = validatePlanInput(body as never)
  if (!validation.ok) {
    return validationFailed(validation.errors)
  }

  try {
    const existing = await getPlan(planId)
    if (!existing) {
      return notFound("Plan not found.")
    }

    const result = await updatePlan(planId, validation.value)
    if (!result.ok) {
      return NextResponse.json(
        {
          error: "That plan code is already in use.",
          errors: [{ field: "planCode", message: "Already in use." }],
        },
        { status: 409 }
      )
    }
    return NextResponse.json({ planId })
  } catch (error) {
    return serverError("renewals/plans/[planId]", error, "Unable to save the plan.")
  }
}

/**
 * DELETE /api/renewals/plans/[planId] — soft-delete.
 *
 * Refused while any active assignment references the plan. Retiring a price is
 * what deactivation is for; deleting a plan that still prices outlets would
 * strand them.
 */
export const DELETE = withRequestContext(
  "/api/renewals/plans/[planId]",
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
    const { planId } = await context.params
    const result = await softDeletePlan(planId, auth.user.id)

    if (!result.ok && result.reason === "not_found") {
      return notFound("Plan not found.")
    }
    if (!result.ok) {
      return NextResponse.json(
        {
          error:
            "This plan is still assigned to outlets. Deactivate it instead, or move those assignments to another plan.",
        },
        { status: 409 }
      )
    }
    return NextResponse.json({ deleted: true })
  } catch (error) {
    return serverError(
      "renewals/plans/[planId]",
      error,
      "Unable to delete the plan."
    )
  }
}
