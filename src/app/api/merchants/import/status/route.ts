import { NextRequest, NextResponse } from "next/server"

import { requireAuthenticatedUser } from "@/lib/auth"
import getPool from "@/lib/db"

export async function GET(request: NextRequest) {
  const user = await requireAuthenticatedUser(request)
  if (!user) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 })
  }

  const pool = getPool()
  const [rows] = await pool.query(
    `
    SELECT id, status, started_at, completed_at, records_imported, error_message
    FROM merchant_import_runs
    ORDER BY started_at DESC
    LIMIT 1
  `
  )

  const latest = (rows as Array<{
    id: string
    status: "running" | "success" | "failed"
    started_at: string
    completed_at: string | null
    records_imported: number
    error_message: string | null
  }>)[0]

  return NextResponse.json({ run: latest ?? null })
}
