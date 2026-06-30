import { NextRequest, NextResponse } from "next/server"

import getPool from "@/lib/db"
import { leadScopeClause } from "@/lib/leads"
import {
  dealGlobalSelectSql,
  isDealStage,
  mapGlobalDeal,
  type DealGlobalRow,
} from "@/lib/deals"
import { resolveDealsUser } from "./helpers"

export async function GET(request: NextRequest) {
  const auth = await resolveDealsUser(request)
  if ("response" in auth) {
    return auth.response
  }
  const { user } = auth

  const { searchParams } = new URL(request.url)
  const stageParam = searchParams.get("stage")?.trim()

  const whereClauses: string[] = []
  const values: Array<string | number> = []

  if (stageParam) {
    if (!isDealStage(stageParam)) {
      return NextResponse.json({ error: "Invalid deal stage." }, { status: 400 })
    }
    whereClauses.push("deals.deal_stage = ?")
    values.push(stageParam)
  }

  // Role scoping: non-managers only see deals on leads assigned to them.
  const scope = leadScopeClause(user, "leads.assigned_user_id")
  if (scope.clause) {
    whereClauses.push(scope.clause)
    values.push(...scope.params)
  }

  const whereSql = whereClauses.length
    ? `WHERE ${whereClauses.join(" AND ")}`
    : ""

  const pool = getPool()
  const [rows] = await pool.query(
    `
      ${dealGlobalSelectSql}
      ${whereSql}
      ORDER BY deals.updated_at DESC
    `,
    values
  )

  return NextResponse.json({
    deals: (rows as DealGlobalRow[]).map(mapGlobalDeal),
  })
}
