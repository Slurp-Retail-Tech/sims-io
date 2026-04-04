import { NextRequest, NextResponse } from "next/server"

import { requireAuthenticatedUser } from "@/lib/auth"
import getPool from "@/lib/db"

export async function GET(request: NextRequest) {
  const user = await requireAuthenticatedUser(request)
  if (!user) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 })
  }

  try {
    const pool = getPool()
    const [rows] = await pool.query(
      `
      SELECT id, status, finished_at, started_at
      FROM plus_update_jobs
      WHERE finished_at IS NOT NULL
      ORDER BY finished_at DESC
      LIMIT 1
    `
    )

    const latest = (rows as Array<{
      id: string
      status: "completed" | "failed"
      finished_at: string | null
      started_at: string
    }>)[0] ?? null

    return NextResponse.json({ job: latest })
  } catch (error) {
    console.error(error)
    return NextResponse.json(
      { error: "Unable to load latest PLUS job." },
      { status: 500 }
    )
  }
}
