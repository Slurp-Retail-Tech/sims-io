import { NextRequest, NextResponse } from "next/server"

import { serverError } from "@/lib/api-errors"
import { withRequestContext } from "@/lib/api-request-context"
import { createPlan, listPlans } from "@/lib/renewal/plans"
import { validatePlanInput } from "@/lib/renewal/plan-validation"

import {
  resolvePlansManager,
  resolvePlansViewer,
  validationFailed,
} from "./helpers"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

/** GET /api/renewals/plans — the catalog. */
export const GET = withRequestContext("/api/renewals/plans", handleGet)

async function handleGet(request: NextRequest): Promise<Response> {
  const auth = await resolvePlansViewer(request)
  if ("response" in auth) {
    return auth.response
  }

  try {
    const { searchParams } = new URL(request.url)
    const plans = await listPlans({
      includeInactive: searchParams.get("includeInactive") === "true",
      search: searchParams.get("q") ?? undefined,
    })
    return NextResponse.json({ plans })
  } catch (error) {
    return serverError("renewals/plans", error, "Unable to load plans.")
  }
}

/** POST /api/renewals/plans — add a plan to the catalog. */
export const POST = withRequestContext("/api/renewals/plans", handlePost)

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

  const validation = validatePlanInput(body as never)
  if (!validation.ok) {
    return validationFailed(validation.errors)
  }

  try {
    const result = await createPlan(validation.value, auth.user.id)
    if (!result.ok) {
      // The unique key is on live rows only, so this genuinely means another
      // plan is using the code right now — not that one once did.
      return NextResponse.json(
        {
          error: "That plan code is already in use.",
          errors: [{ field: "planCode", message: "Already in use." }],
        },
        { status: 409 }
      )
    }
    return NextResponse.json({ planId: result.planId }, { status: 201 })
  } catch (error) {
    return serverError("renewals/plans", error, "Unable to create the plan.")
  }
}
