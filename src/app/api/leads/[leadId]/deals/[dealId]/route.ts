import { NextRequest, NextResponse } from "next/server"
import type { ResultSetHeader } from "mysql2/promise"

import getPool from "@/lib/db"
import { canEditLead } from "@/lib/leads"
import {
  dealSelectSql,
  isCloseLostReason,
  isDealStage,
  mapDeal,
  reconcileDealFields,
  type DealRow,
} from "@/lib/deals"
import {
  cleanString,
  loadLeadAssignment,
  parseLeadId,
  resolveLeadsUser,
} from "../../../helpers"

function parseDealId(value: string): number | null {
  const parsed = Number.parseInt(value, 10)
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null
  }
  return parsed
}

type PatchDealBody = {
  dealName?: unknown
  dealStage?: unknown
  amount?: unknown
  closedDate?: unknown
  closeLostReason?: unknown
}

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ leadId: string; dealId: string }> }
) {
  const auth = await resolveLeadsUser(request)
  if ("response" in auth) {
    return auth.response
  }
  const { user } = auth

  const { leadId, dealId } = await context.params
  const parsedLeadId = parseLeadId(leadId)
  const parsedDealId = parseDealId(dealId)
  if (parsedLeadId === null || parsedDealId === null) {
    return NextResponse.json({ error: "Invalid id." }, { status: 400 })
  }

  const lead = await loadLeadAssignment(parsedLeadId)
  if (!lead || !canEditLead(user, lead)) {
    return NextResponse.json({ error: "Lead not found." }, { status: 404 })
  }

  const pool = getPool()
  const [existingRows] = await pool.query(
    `${dealSelectSql} WHERE deals.id = ? AND deals.lead_id = ? LIMIT 1`,
    [parsedDealId, parsedLeadId]
  )
  const existing = (existingRows as DealRow[])[0]
  if (!existing) {
    return NextResponse.json({ error: "Deal not found." }, { status: 404 })
  }

  let body: PatchDealBody
  try {
    body = (await request.json()) as PatchDealBody
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 })
  }

  const dealName = cleanString(body.dealName) ?? existing.deal_name
  const stageRaw =
    typeof body.dealStage === "string" ? body.dealStage : existing.deal_stage
  if (!isDealStage(stageRaw)) {
    return NextResponse.json({ error: "Invalid deal stage." }, { status: 400 })
  }
  const amount =
    body.amount === undefined || body.amount === null
      ? Number(existing.amount)
      : Number(body.amount)
  const closedDate =
    body.closedDate === undefined ? existing.closed_date : cleanString(body.closedDate)
  const closeLostReasonRaw =
    body.closeLostReason === undefined
      ? existing.close_lost_reason
      : cleanString(body.closeLostReason)
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

  await pool.query<ResultSetHeader>(
    `
      UPDATE deals
      SET deal_name = ?, deal_stage = ?, amount = ?, closed_date = ?, close_lost_reason = ?,
          updated_at = CURRENT_TIMESTAMP(3)
      WHERE id = ? AND lead_id = ?
    `,
    [
      dealName,
      stageRaw,
      amount,
      reconciled.closedDate,
      reconciled.closeLostReason,
      parsedDealId,
      parsedLeadId,
    ]
  )

  const [rows] = await pool.query(
    `${dealSelectSql} WHERE deals.id = ? LIMIT 1`,
    [parsedDealId]
  )
  return NextResponse.json({ deal: mapDeal((rows as DealRow[])[0]) })
}

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ leadId: string; dealId: string }> }
) {
  const auth = await resolveLeadsUser(request)
  if ("response" in auth) {
    return auth.response
  }
  const { user } = auth

  const { leadId, dealId } = await context.params
  const parsedLeadId = parseLeadId(leadId)
  const parsedDealId = parseDealId(dealId)
  if (parsedLeadId === null || parsedDealId === null) {
    return NextResponse.json({ error: "Invalid id." }, { status: 400 })
  }

  const lead = await loadLeadAssignment(parsedLeadId)
  if (!lead || !canEditLead(user, lead)) {
    return NextResponse.json({ error: "Lead not found." }, { status: 404 })
  }

  const pool = getPool()
  const [result] = await pool.query<ResultSetHeader>(
    `DELETE FROM deals WHERE id = ? AND lead_id = ?`,
    [parsedDealId, parsedLeadId]
  )
  if (result.affectedRows === 0) {
    return NextResponse.json({ error: "Deal not found." }, { status: 404 })
  }

  return NextResponse.json({ ok: true })
}
