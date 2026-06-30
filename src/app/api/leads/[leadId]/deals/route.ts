import { NextRequest, NextResponse } from "next/server"
import type { ResultSetHeader } from "mysql2/promise"

import getPool from "@/lib/db"
import { canEditLead, canViewLead } from "@/lib/leads"
import {
  dealSelectSql,
  isCloseLostReason,
  isDealStage,
  reconcileDealFields,
  mapDeal,
  type DealRow,
} from "@/lib/deals"
import {
  cleanString,
  loadLeadAssignment,
  parseLeadId,
  resolveLeadsUser,
} from "../../helpers"

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ leadId: string }> }
) {
  const auth = await resolveLeadsUser(request)
  if ("response" in auth) {
    return auth.response
  }
  const { user } = auth

  const { leadId } = await context.params
  const parsedLeadId = parseLeadId(leadId)
  if (parsedLeadId === null) {
    return NextResponse.json({ error: "Invalid lead id." }, { status: 400 })
  }

  const lead = await loadLeadAssignment(parsedLeadId)
  if (!lead || !canViewLead(user, lead)) {
    return NextResponse.json({ error: "Lead not found." }, { status: 404 })
  }

  const pool = getPool()
  const [rows] = await pool.query(
    `${dealSelectSql} WHERE deals.lead_id = ? ORDER BY deals.created_at DESC`,
    [parsedLeadId]
  )
  return NextResponse.json({ deals: (rows as DealRow[]).map(mapDeal) })
}

type CreateDealBody = {
  dealName?: unknown
  dealStage?: unknown
  amount?: unknown
  closedDate?: unknown
  closeLostReason?: unknown
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ leadId: string }> }
) {
  const auth = await resolveLeadsUser(request)
  if ("response" in auth) {
    return auth.response
  }
  const { user } = auth

  const { leadId } = await context.params
  const parsedLeadId = parseLeadId(leadId)
  if (parsedLeadId === null) {
    return NextResponse.json({ error: "Invalid lead id." }, { status: 400 })
  }

  const lead = await loadLeadAssignment(parsedLeadId)
  if (!lead || !canViewLead(user, lead)) {
    return NextResponse.json({ error: "Lead not found." }, { status: 404 })
  }
  if (!canEditLead(user, lead)) {
    return NextResponse.json({ error: "Forbidden." }, { status: 403 })
  }

  let body: CreateDealBody
  try {
    body = (await request.json()) as CreateDealBody
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 })
  }

  const dealName = cleanString(body.dealName)
  if (!dealName) {
    return NextResponse.json({ error: "Deal name is required." }, { status: 400 })
  }

  const stageRaw = cleanString(body.dealStage) ?? "To Qualify"
  if (!isDealStage(stageRaw)) {
    return NextResponse.json({ error: "Invalid deal stage." }, { status: 400 })
  }

  const amount = Number(body.amount)
  const closedDate = cleanString(body.closedDate)
  const closeLostReasonRaw = cleanString(body.closeLostReason)
  if (closeLostReasonRaw && !isCloseLostReason(closeLostReasonRaw)) {
    return NextResponse.json({ error: "Invalid close lost reason." }, { status: 400 })
  }

  const reconciled = reconcileDealFields({
    stage: stageRaw,
    amount,
    closedDate,
    closeLostReason:
      closeLostReasonRaw && isCloseLostReason(closeLostReasonRaw)
        ? closeLostReasonRaw
        : null,
  })
  if (!reconciled.ok) {
    return NextResponse.json({ error: reconciled.error }, { status: 400 })
  }

  const pool = getPool()
  const [insertResult] = await pool.query<ResultSetHeader>(
    `
      INSERT INTO deals (
        lead_id, deal_name, deal_stage, amount, closed_date, close_lost_reason, created_by_user_id
      )
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `,
    [
      parsedLeadId,
      dealName,
      stageRaw,
      amount,
      reconciled.closedDate,
      reconciled.closeLostReason,
      user.id,
    ]
  )

  const [rows] = await pool.query(
    `${dealSelectSql} WHERE deals.id = ? LIMIT 1`,
    [insertResult.insertId]
  )
  return NextResponse.json(
    { deal: mapDeal((rows as DealRow[])[0]) },
    { status: 201 }
  )
}
