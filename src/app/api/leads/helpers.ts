import { NextRequest, NextResponse } from "next/server"

import { requireAuthenticatedUser } from "@/lib/auth"
import { hasPageAccessForPath } from "@/lib/page-access"
import type { LeadAuthUser } from "@/lib/leads"

/**
 * Resolves the authenticated user and enforces access to the Leads Management
 * module. Mirrors `resolveAuthUser` in the sales-appointments helpers, but
 * gates on the `/sales/leads` access key (Super Admin bypasses).
 *
 * `allowedPaths` lets callers accept additional entry points — e.g. the lead
 * list is also used by the Sales Appointments lead picker, so that route also
 * accepts `/sales/appointments` access.
 */
export async function resolveLeadsUser(
  request: NextRequest,
  allowedPaths: string[] = ["/sales/leads"]
): Promise<{ user: LeadAuthUser } | { response: NextResponse }> {
  const user = await requireAuthenticatedUser(request)
  if (!user) {
    return {
      response: NextResponse.json({ error: "Unauthorized." }, { status: 401 }),
    }
  }

  const authUser: LeadAuthUser = {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    department: user.department,
    pageAccess: user.pageAccess,
  }

  const hasAccess = allowedPaths.some((path) =>
    hasPageAccessForPath(path, authUser.pageAccess)
  )
  if (authUser.role !== "Super Admin" && !hasAccess) {
    return {
      response: NextResponse.json({ error: "Forbidden." }, { status: 403 }),
    }
  }

  return { user: authUser }
}

export function parseLeadId(value: string): number | null {
  const parsed = Number.parseInt(value, 10)
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null
  }
  return parsed
}

export function cleanString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null
  }
  const trimmed = value.trim()
  return trimmed ? trimmed : null
}

export function parseOptionalUserId(value: unknown): number | null {
  const cleaned = cleanString(value)
  if (!cleaned) {
    return null
  }
  const parsed = Number.parseInt(cleaned, 10)
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null
  }
  return parsed
}

export const TELEPHONE_PATTERN = /^\d{8,15}$/

/**
 * Resolves an optional `dealId` from an activity payload, ensuring the deal
 * exists and belongs to the given lead. Returns:
 *  - `{ dealId: null }` when no link was requested,
 *  - `{ dealId: <id-string> }` when the link is valid,
 *  - `{ error }` when the id is malformed or the deal is not on this lead.
 */
export async function resolveActivityDealId(
  rawDealId: unknown,
  leadId: number
): Promise<{ dealId: string | null } | { error: string }> {
  const parsed = parseOptionalUserId(rawDealId)
  if (rawDealId !== null && rawDealId !== undefined && rawDealId !== "" && parsed === null) {
    return { error: "Invalid deal id." }
  }
  if (parsed === null) {
    return { dealId: null }
  }
  const { default: getPool } = await import("@/lib/db")
  const [rows] = await getPool().query(
    `SELECT id FROM deals WHERE id = ? AND lead_id = ? LIMIT 1`,
    [parsed, leadId]
  )
  if (!(rows as Array<{ id: string }>)[0]) {
    return { error: "Deal not found on this lead." }
  }
  return { dealId: String(parsed) }
}

/**
 * Loads the minimal lead row needed for deal/activity authorisation.
 * Returns null if the lead does not exist.
 */
export async function loadLeadAssignment(
  leadId: number
): Promise<{ id: string; assigned_user_id: string | null } | null> {
  const { default: getPool } = await import("@/lib/db")
  const [rows] = await getPool().query(
    `SELECT id, assigned_user_id FROM leads WHERE id = ? LIMIT 1`,
    [leadId]
  )
  const row = (rows as Array<{ id: string; assigned_user_id: string | null }>)[0]
  return row ?? null
}
