import { NextRequest, NextResponse } from "next/server"

import getPool from "@/lib/db"
import { resolveLeadsUser } from "../../leads/helpers"

/**
 * Lists active Sales & Marketing "User" accounts that a lead can be assigned
 * to. Gated behind Leads Management access.
 */
export async function GET(request: NextRequest) {
  const auth = await resolveLeadsUser(request)
  if ("response" in auth) {
    return auth.response
  }

  const pool = getPool()
  const [rows] = await pool.query(
    `
      SELECT id, name, email
      FROM users
      WHERE department = 'Sales & Marketing'
        AND role = 'User'
        AND status = 'active'
      ORDER BY name ASC
    `
  )

  return NextResponse.json({
    users: (rows as Array<{ id: string; name: string; email: string }>).map(
      (row) => ({ id: String(row.id), name: row.name, email: row.email })
    ),
  })
}
