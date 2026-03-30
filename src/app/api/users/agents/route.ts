import { NextRequest, NextResponse } from "next/server"

import getPool from "@/lib/db"
import { requireAuthenticatedUser } from "@/lib/auth"

export async function GET(request: NextRequest) {
  const user = await requireAuthenticatedUser(request)
  if (!user) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 })
  }

  const pool = getPool()
  const [rows] = await pool.query(
    `
    SELECT id, name, email
    FROM users
    WHERE department = 'Merchant Success'
      AND status = 'active'
    ORDER BY name ASC
  `
  )

  return NextResponse.json({ users: rows })
}
