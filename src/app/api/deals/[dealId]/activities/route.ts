import { NextRequest, NextResponse } from "next/server"

import getPool from "@/lib/db"
import { canViewLead } from "@/lib/leads"
import {
  dealActivitySelectSql,
  mapDealActivity,
  type DealActivityRow,
} from "@/lib/deal-activities"
import { parseDealId, resolveDealsUser } from "../../helpers"

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ dealId: string }> }
) {
  const auth = await resolveDealsUser(request)
  if ("response" in auth) {
    return auth.response
  }
  const { user } = auth

  const { dealId } = await context.params
  const parsedDealId = parseDealId(dealId)
  if (parsedDealId === null) {
    return NextResponse.json({ error: "Invalid deal id." }, { status: 400 })
  }

  const pool = getPool()
  const [authRows] = await pool.query(
    `
      SELECT deals.id, leads.assigned_user_id
      FROM deals
      INNER JOIN leads ON leads.id = deals.lead_id
      WHERE deals.id = ?
      LIMIT 1
    `,
    [parsedDealId]
  )
  const existing = (authRows as Array<{ id: string; assigned_user_id: string | null }>)[0]
  if (!existing || !canViewLead(user, { assigned_user_id: existing.assigned_user_id })) {
    return NextResponse.json({ error: "Deal not found." }, { status: 404 })
  }

  const [rows] = await pool.query(
    `${dealActivitySelectSql} WHERE deal_activities.deal_id = ? ORDER BY deal_activities.created_at DESC, deal_activities.id DESC`,
    [parsedDealId]
  )
  return NextResponse.json({
    activities: (rows as DealActivityRow[]).map(mapDealActivity),
  })
}
