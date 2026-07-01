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

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/

// Reads an optional `YYYY-MM-DD` query param. Returns the trimmed value,
// `null` when absent, or `false` when present but malformed.
function readDateParam(
  searchParams: URLSearchParams,
  key: string
): string | null | false {
  const raw = searchParams.get(key)?.trim()
  if (!raw) {
    return null
  }
  return DATE_PATTERN.test(raw) ? raw : false
}

export async function GET(request: NextRequest) {
  const auth = await resolveDealsUser(request)
  if ("response" in auth) {
    return auth.response
  }
  const { user } = auth

  const { searchParams } = new URL(request.url)
  const stageParam = searchParams.get("stage")?.trim()
  const assignedParam = searchParams.get("assigned")?.trim()

  // Date-range filters: created / last-activity / close, each optional and all
  // combinable. last_activity_at is a computed column, so it filters via HAVING.
  const dateParams = {
    createdFrom: readDateParam(searchParams, "createdFrom"),
    createdTo: readDateParam(searchParams, "createdTo"),
    activityFrom: readDateParam(searchParams, "activityFrom"),
    activityTo: readDateParam(searchParams, "activityTo"),
    closedFrom: readDateParam(searchParams, "closedFrom"),
    closedTo: readDateParam(searchParams, "closedTo"),
  }
  if (Object.values(dateParams).some((value) => value === false)) {
    return NextResponse.json(
      { error: "Invalid date filter. Expected YYYY-MM-DD." },
      { status: 400 }
    )
  }

  const whereClauses: string[] = []
  const values: Array<string | number> = []
  const havingClauses: string[] = []
  const havingValues: Array<string | number> = []

  if (stageParam) {
    if (!isDealStage(stageParam)) {
      return NextResponse.json({ error: "Invalid deal stage." }, { status: 400 })
    }
    whereClauses.push("deals.deal_stage = ?")
    values.push(stageParam)
  }

  if (dateParams.createdFrom) {
    whereClauses.push("DATE(deals.created_at) >= ?")
    values.push(dateParams.createdFrom)
  }
  if (dateParams.createdTo) {
    whereClauses.push("DATE(deals.created_at) <= ?")
    values.push(dateParams.createdTo)
  }
  if (dateParams.closedFrom) {
    whereClauses.push("deals.closed_date >= ?")
    values.push(dateParams.closedFrom)
  }
  if (dateParams.closedTo) {
    whereClauses.push("deals.closed_date <= ?")
    values.push(dateParams.closedTo)
  }
  if (dateParams.activityFrom) {
    havingClauses.push("DATE(last_activity_at) >= ?")
    havingValues.push(dateParams.activityFrom)
  }
  if (dateParams.activityTo) {
    havingClauses.push("DATE(last_activity_at) <= ?")
    havingValues.push(dateParams.activityTo)
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
  const havingSql = havingClauses.length
    ? `HAVING ${havingClauses.join(" AND ")}`
    : ""

  const pool = getPool()
  const [rows] = await pool.query(
    `
      ${dealGlobalSelectSql}
      ${whereSql}
      ${havingSql}
      ORDER BY deals.updated_at DESC
    `,
    [...values, ...havingValues]
  )

  return NextResponse.json({
    deals: (rows as DealGlobalRow[]).map(mapGlobalDeal),
  })
}
