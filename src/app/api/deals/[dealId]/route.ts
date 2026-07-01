import { NextRequest, NextResponse } from "next/server"
import type { ResultSetHeader } from "mysql2/promise"

import getPool from "@/lib/db"
import { canEditLead, canViewLead } from "@/lib/leads"
import {
  dealGlobalSelectSql,
  isCloseLostReason,
  isDealStage,
  mapGlobalDeal,
  reconcileDealFields,
  type DealGlobalRow,
  type DealStage,
} from "@/lib/deals"
import { logDealActivity } from "@/lib/deal-activities"
import { parseDealId, resolveDealsUser } from "../helpers"

type DealAuthRow = {
  id: string
  deal_name: string
  deal_stage: string
  amount: string
  closed_date: string | null
  close_lost_reason: string | null
  close_lost_remarks: string | null
  assigned_user_id: string | null
}

type PatchDealBody = {
  dealName?: unknown
  dealStage?: unknown
  amount?: unknown
  closedDate?: unknown
  closeLostReason?: unknown
  closeLostRemarks?: unknown
}

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
  // 404 (not 403) when the deal exists but is out of scope, to avoid leaking existence.
  if (!existing || !canViewLead(user, { assigned_user_id: existing.assigned_user_id })) {
    return NextResponse.json({ error: "Deal not found." }, { status: 404 })
  }

  const [rows] = await pool.query(
    `${dealGlobalSelectSql} WHERE deals.id = ? LIMIT 1`,
    [parsedDealId]
  )
  return NextResponse.json({ deal: mapGlobalDeal((rows as DealGlobalRow[])[0]) })
}

export async function PATCH(
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
      SELECT
        deals.id, deals.deal_name, deals.deal_stage, deals.amount,
        deals.closed_date, deals.close_lost_reason, deals.close_lost_remarks,
        leads.assigned_user_id
      FROM deals
      INNER JOIN leads ON leads.id = deals.lead_id
      WHERE deals.id = ?
      LIMIT 1
    `,
    [parsedDealId]
  )
  const existing = (authRows as DealAuthRow[])[0]
  if (!existing) {
    return NextResponse.json({ error: "Deal not found." }, { status: 404 })
  }
  if (!canEditLead(user, { assigned_user_id: existing.assigned_user_id })) {
    return NextResponse.json({ error: "Forbidden." }, { status: 403 })
  }

  let body: PatchDealBody
  try {
    body = (await request.json()) as PatchDealBody
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 })
  }

  // Merge incoming fields over the existing record, then reconcile.
  const dealName =
    typeof body.dealName === "string" && body.dealName.trim()
      ? body.dealName.trim()
      : existing.deal_name

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
    body.closedDate === undefined
      ? existing.closed_date
      : typeof body.closedDate === "string" && body.closedDate.trim()
        ? body.closedDate.trim()
        : null

  const closeLostReason =
    body.closeLostReason === undefined
      ? existing.close_lost_reason
      : typeof body.closeLostReason === "string" && body.closeLostReason.trim()
        ? body.closeLostReason.trim()
        : null

  if (closeLostReason && !isCloseLostReason(closeLostReason)) {
    return NextResponse.json({ error: "Invalid close lost reason." }, { status: 400 })
  }

  const closeLostRemarks =
    body.closeLostRemarks === undefined
      ? existing.close_lost_remarks
      : typeof body.closeLostRemarks === "string" && body.closeLostRemarks.trim()
        ? body.closeLostRemarks.trim()
        : null

  const reconciled = reconcileDealFields({
    stage: stageRaw,
    amount,
    closedDate,
    closeLostReason: closeLostReason as never,
    closeLostRemarks,
  })
  if (!reconciled.ok) {
    return NextResponse.json({ error: reconciled.error }, { status: 400 })
  }

  await pool.query<ResultSetHeader>(
    `
      UPDATE deals
      SET deal_name = ?, deal_stage = ?, amount = ?, closed_date = ?, close_lost_reason = ?,
          close_lost_remarks = ?, updated_at = CURRENT_TIMESTAMP(3)
      WHERE id = ?
    `,
    [
      dealName,
      stageRaw,
      amount,
      reconciled.closedDate,
      reconciled.closeLostReason,
      reconciled.closeLostRemarks,
      parsedDealId,
    ]
  )

  if (existing.deal_stage !== stageRaw) {
    await logDealActivity(pool, {
      dealId: parsedDealId,
      activityType: "stage_changed",
      fromStage: existing.deal_stage as DealStage,
      toStage: stageRaw,
      userId: user.id,
    })
  }

  const [rows] = await pool.query(
    `${dealGlobalSelectSql} WHERE deals.id = ? LIMIT 1`,
    [parsedDealId]
  )
  return NextResponse.json({ deal: mapGlobalDeal((rows as DealGlobalRow[])[0]) })
}

export async function DELETE(
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
  if (!existing) {
    return NextResponse.json({ error: "Deal not found." }, { status: 404 })
  }
  if (!canEditLead(user, { assigned_user_id: existing.assigned_user_id })) {
    return NextResponse.json({ error: "Forbidden." }, { status: 403 })
  }

  await pool.query<ResultSetHeader>(`DELETE FROM deals WHERE id = ?`, [parsedDealId])

  return NextResponse.json({ ok: true })
}
