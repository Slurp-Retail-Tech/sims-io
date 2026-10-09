import { NextRequest, NextResponse } from "next/server"

import { resolveApiUser } from "@/lib/api-auth"
import type { ApiAuthUser } from "@/lib/api-access"

/** Opening the catalog. */
export const PLANS_VIEW_PATH = "/renewal-retention/plans"
/** Creating or editing a plan or an assignment. */
export const PLANS_MANAGE_PATH = "/renewal-retention/plans/manage"
/** Signing off an override that varies beyond the configured threshold. */
export const PLANS_APPROVE_PATH = "/renewal-retention/plans/approve-override"

type Resolved = { user: ApiAuthUser } | { response: NextResponse }

/**
 * Gate a read of the catalog.
 *
 * The manage and approve keys each imply the ability to see what they act on,
 * so any of the three opens a read. They are OR-ed rather than nested because
 * `evaluateApiAccess` already ORs `allowedPaths`.
 */
export async function resolvePlansViewer(request: NextRequest): Promise<Resolved> {
  return resolveApiUser(request, {
    allowedPaths: [PLANS_VIEW_PATH, PLANS_MANAGE_PATH, PLANS_APPROVE_PATH],
  })
}

/** Gate a write. Holding the view key alone is not enough. */
export async function resolvePlansManager(request: NextRequest): Promise<Resolved> {
  return resolveApiUser(request, { allowedPaths: [PLANS_MANAGE_PATH] })
}

/**
 * Gate an override decision.
 *
 * Deliberately not implied by the manage key: approving a price nobody else
 * signed off is the control, and a control one person can both create and
 * clear is not a control.
 */
export async function resolvePlansApprover(request: NextRequest): Promise<Resolved> {
  return resolveApiUser(request, { allowedPaths: [PLANS_APPROVE_PATH] })
}

/** 422 carrying per-field messages, so a form can mark its own inputs. */
export function validationFailed(
  errors: readonly { field: string; message: string }[]
): NextResponse {
  return NextResponse.json(
    { error: "Please correct the highlighted fields.", errors },
    { status: 422 }
  )
}
