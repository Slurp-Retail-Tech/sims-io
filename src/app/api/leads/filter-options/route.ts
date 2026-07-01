import { NextRequest, NextResponse } from "next/server"

import getPool from "@/lib/db"
import { leadScopeClause } from "@/lib/leads"
import { resolveLeadsUser } from "../helpers"

/**
 * Returns the distinct business types present across the leads the current
 * user may see (including archived), used to populate the leads table filter.
 * Assigned-user options are sourced separately from `/api/users/sales-agents`.
 */
export async function GET(request: NextRequest) {
  const auth = await resolveLeadsUser(request)
  if ("response" in auth) {
    return auth.response
  }
  const { user } = auth

  const scope = leadScopeClause(user, "leads.assigned_user_id")
  const whereClauses = ["leads.business_type IS NOT NULL", "leads.business_type <> ''"]
  if (scope.clause) {
    whereClauses.push(scope.clause)
  }

  const pool = getPool()
  const [rows] = await pool.query(
    `
      SELECT DISTINCT leads.business_type AS businessType
      FROM leads
      WHERE ${whereClauses.join(" AND ")}
      ORDER BY leads.business_type ASC
    `,
    scope.params
  )

  const businessTypes = (rows as Array<{ businessType: string }>)
    .map((row) => row.businessType)
    .filter(Boolean)

  return NextResponse.json({ businessTypes })
}
