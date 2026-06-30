import { NextRequest, NextResponse } from "next/server"

import getPool from "@/lib/db"
import { isLeadManager, leadScopeClause } from "@/lib/leads"
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
  const assignedParam = searchParams.get("assigned")?.trim()

  const whereClauses: string[] = []
  const values: Array<string | number> = []

  if (stageParam) {
    if (!isDealStage(stageParam)) {
      return NextResponse.json({ error: "Invalid deal stage." }, { status: 400 })
    }
    whereClauses.push("deals.deal_stage = ?")
    values.push(stageParam)
  }

  // Assigned-user filter is only honoured for managers. Non-managers are always
  // scoped to their own deals by leadScopeClause below, so the param is ignored.
  if (assignedParam && isLeadManager(user)) {
    if (assignedParam === "unassigned") {
      whereClauses.push("leads.assigned_user_id IS NULL")
    } else {
      whereClauses.push("leads.assigned_user_id = ?")
      values.push(assignedParam)
    }
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
