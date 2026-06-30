import { NextRequest, NextResponse } from "next/server"

import { requireAuthenticatedUser } from "@/lib/auth"
import { hasPageAccessForPath } from "@/lib/page-access"
import type { LeadAuthUser } from "@/lib/leads"

/**
 * Resolves the authenticated user and enforces access to the Deals page.
 * Super Admin bypasses; everyone else needs the `/sales/deals` access key.
 */
export async function resolveDealsUser(
  request: NextRequest
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

  if (
    authUser.role !== "Super Admin" &&
    !hasPageAccessForPath("/sales/deals", authUser.pageAccess)
  ) {
    return {
      response: NextResponse.json({ error: "Forbidden." }, { status: 403 }),
    }
  }

  return { user: authUser }
}

export function parseDealId(value: string): number | null {
  const parsed = Number.parseInt(value, 10)
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null
  }
  return parsed
}
