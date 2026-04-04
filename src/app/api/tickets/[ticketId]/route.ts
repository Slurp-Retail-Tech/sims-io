import { randomUUID } from "node:crypto"
import { NextRequest, NextResponse } from "next/server"
import type { RowDataPacket } from "mysql2"

import { hashOpaqueToken, requireAuthenticatedUser } from "@/lib/auth"
import getPool from "@/lib/db"
import { normalizeDateTimeForMysqlInput } from "@/lib/mysql-datetime"
import { resolveStoredObjectUrl } from "@/lib/storage"

type TicketDetailRow = RowDataPacket & {
  id: string
  merchant_name: string | null
  phone_number: string | null
  franchise_name_resolved: string | null
  outlet_name_resolved: string | null
  fid: string | null
  oid: string | null
  status: string
  hidden: number
  issue_type: string | null
  issue_subcategory1: string | null
  issue_subcategory2: string | null
  issue_description: string | null
  ticket_description: string | null
  clickup_link: string | null
  clickup_task_id: string | null
  clickup_task_status: string | null
  clickup_task_status_synced_at: string | null
  attachment_url: string | null
  attachment_url_2: string | null
  attachment_url_3: string | null
  opened_at: string | null
  merchant_sentiment: string | null
  created_at: string
  updated_at: string
  closed_at: string | null
  updated_by: string | null
  updated_by_display: string | null
  ms_pic_user_id: string | null
  ms_pic_name: string | null
}

type CsatTokenRow = RowDataPacket & {
  token_hash: string
  created_at: string
  expires_at: string
  used_at: string | null
}

type CsatResponseRow = RowDataPacket & {
  support_score: string | null
  support_reason: string | null
  product_score: string | null
  product_feedback: string | null
  submitted_at: string
}

type CsatSendHistoryRow = RowDataPacket & {
  ticket_id: string
}

async function getActorLabel(userId: string) {
  const pool = getPool()
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT name, email FROM users WHERE id = ? LIMIT 1",
    [userId]
  )
  const actor = rows[0] as { name?: string; email?: string } | undefined
  return actor?.name || actor?.email || userId
}

async function resolveMerchantNames(
  pool: ReturnType<typeof getPool>,
  fid: string,
  oid: string
) {
  const [rows] = await pool.query(
    `
    SELECT
      merchants.name AS franchise_name,
      merchant_outlets.name AS outlet_name
    FROM merchants
    LEFT JOIN merchant_outlets
      ON merchant_outlets.merchant_external_id = merchants.external_id
      AND merchant_outlets.external_id = ?
    WHERE merchants.fid = ?
    LIMIT 1
  `,
    [oid, fid]
  )

  const match = (rows as Array<{
    franchise_name: string | null
    outlet_name: string | null
  }>)[0]

  if (match) {
    return {
      franchiseName: match.franchise_name ?? null,
      outletName: match.outlet_name ?? null,
    }
  }

  const [fallbackRows] = await pool.query(
    `
    SELECT
      merchants.name AS franchise_name,
      merchant_outlets.name AS outlet_name
    FROM merchant_outlets
    INNER JOIN merchants
      ON merchants.external_id = merchant_outlets.merchant_external_id
    WHERE merchant_outlets.external_id = ?
    LIMIT 1
  `,
    [oid]
  )

  const fallback = (fallbackRows as Array<{
    franchise_name: string | null
    outlet_name: string | null
  }>)[0]

  return {
    franchiseName: fallback?.franchise_name ?? null,
    outletName: fallback?.outlet_name ?? null,
  }
}

function toSurveyStatus(
  token: CsatTokenRow | null,
  response: CsatResponseRow | null,
  wasWhatsappSent: boolean
) {
  if (!token) {
    return "Not Sent"
  }
  if (response) {
    return "Responded"
  }
  if (token.used_at) {
    return "Used"
  }
  const expires = new Date(token.expires_at)
  if (!Number.isNaN(expires.valueOf()) && expires.getTime() < Date.now()) {
    return "Expired"
  }
  if (wasWhatsappSent) {
    return "Send"
  }
  return "Generated"
}

function isClosedStatus(value: string | null | undefined) {
  const normalized = (value ?? "").trim().toLowerCase()
  return normalized === "resolved" || normalized === "closed"
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ ticketId: string }> }
) {
  const user = await requireAuthenticatedUser(request)
  if (!user) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 })
  }

  const { ticketId } = await params
  const pool = getPool()

  const [ticketRows] = await pool.query<TicketDetailRow[]>(
    `
    SELECT
      tickets.id,
      tickets.merchant_name,
      tickets.phone_number,
      tickets.franchise_name_resolved,
      tickets.outlet_name_resolved,
      tickets.fid,
      tickets.oid,
      tickets.status,
      tickets.hidden,
      tickets.issue_type,
      tickets.issue_subcategory1,
      tickets.issue_subcategory2,
      tickets.issue_description,
      tickets.ticket_description,
      tickets.clickup_link,
      tickets.clickup_task_id,
      tickets.clickup_task_status,
      tickets.clickup_task_status_synced_at,
      tickets.attachment_url,
      tickets.attachment_url_2,
      tickets.attachment_url_3,
      tickets.opened_at,
      tickets.merchant_sentiment,
      tickets.created_at,
      tickets.updated_at,
      tickets.closed_at,
      tickets.updated_by,
      updater.name AS updated_by_display,
      tickets.ms_pic_user_id,
      users.name AS ms_pic_name
    FROM tickets
    LEFT JOIN users
      ON users.id = tickets.ms_pic_user_id
    LEFT JOIN users AS updater
      ON updater.id = tickets.updated_by
    WHERE tickets.id = ?
    LIMIT 1
  `,
    [ticketId]
  )

  const row = ticketRows[0]
  if (!row) {
    return NextResponse.json({ error: "Ticket not found." }, { status: 404 })
  }

  const [tokenRows] = await pool.query<CsatTokenRow[]>(
    `
    SELECT token_hash, created_at, expires_at, used_at
    FROM csat_tokens
    WHERE ticket_id = ?
    ORDER BY id DESC
    LIMIT 1
  `,
    [ticketId]
  )
  const token = tokenRows[0] ?? null

  const [responseRows] = await pool.query<CsatResponseRow[]>(
    `
    SELECT support_score, support_reason, product_score, product_feedback, submitted_at
    FROM csat_responses
    WHERE ticket_id = ?
    ORDER BY id DESC
    LIMIT 1
  `,
    [ticketId]
  )
  const response = responseRows[0] ?? null

  const [sendRows] = await pool.query<CsatSendHistoryRow[]>(
    `
    SELECT ticket_id
    FROM ticket_history
    WHERE ticket_id = ?
      AND field_name IN ('csat_link_shared', 'csat_link_shared_at')
    LIMIT 1
  `,
    [ticketId]
  )
  const wasWhatsappSent = sendRows.length > 0

  const attachments = [
    row.attachment_url,
    row.attachment_url_2,
    row.attachment_url_3,
  ]
    .map((value) => resolveStoredObjectUrl(value))
    .filter(Boolean) as string[]

  return NextResponse.json({
    ticket: {
      id: row.id,
      merchantName: row.merchant_name,
      customerPhone: row.phone_number,
      franchiseName: row.franchise_name_resolved,
      outletName: row.outlet_name_resolved,
      fid: row.fid,
      oid: row.oid,
      status: row.status,
      hidden: Boolean(row.hidden),
      category: row.issue_type,
      subcategory1: row.issue_subcategory1,
      subcategory2: row.issue_subcategory2,
      issueDescription: row.issue_description,
      ticketDescription: row.ticket_description,
      clickupLink: row.clickup_link,
      clickupTaskId: row.clickup_task_id,
      clickupTaskStatus: row.clickup_task_status,
      clickupTaskStatusSyncedAt: row.clickup_task_status_synced_at,
      attachments,
      openedAt: row.opened_at,
      merchantSentiment: row.merchant_sentiment,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      closedAt: row.closed_at,
      updatedBy: row.updated_by_display ?? row.updated_by,
      msPicUserId: row.ms_pic_user_id,
      msPicName: row.ms_pic_name,
      csat: {
        surveyStatus: toSurveyStatus(token, response, wasWhatsappSent),
        tokenHash: token?.token_hash ?? null,
        tokenPreview: token?.token_hash
          ? `${token.token_hash.slice(0, 8)}...${token.token_hash.slice(-4)}`
          : null,
        createdAt: token?.created_at ?? null,
        expiresAt: token?.expires_at ?? null,
        usedAt: token?.used_at ?? null,
        response: response
          ? {
              supportScore: response.support_score,
              supportComment: response.support_reason,
              productScore: response.product_score,
              productFeedback: response.product_feedback,
              submittedAt: response.submitted_at,
            }
          : null,
      },
    },
  })
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ ticketId: string }> }
) {
  const user = await requireAuthenticatedUser(request)
  if (!user) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 })
  }

  const { ticketId } = await params
  const body = (await request.json()) as {
    status?: string
    hidden?: boolean
    merchantName?: string
    customerPhone?: string
    fid?: string
    oid?: string
    category?: string
    subcategory1?: string
    subcategory2?: string | null
    issueDescription?: string
    ticketDescription?: string | null
    msPicUserId?: string | null
    clickupTaskId?: string | null
    clickupLink?: string | null
    clickupTaskStatus?: string | null
    clickupTaskStatusSyncedAt?: string | null
    openedAt?: string | null
    merchantSentiment?: string | null
  }

  const pool = getPool()
  const [rows] = await pool.query<TicketDetailRow[]>(
    `
    SELECT
      id,
      status,
      hidden,
      merchant_name,
      phone_number,
      fid,
      oid,
      franchise_name_resolved,
      outlet_name_resolved,
      issue_type,
      issue_subcategory1,
      issue_subcategory2,
      issue_description,
      ticket_description,
      ms_pic_user_id,
      clickup_task_id,
      clickup_link,
      clickup_task_status,
      clickup_task_status_synced_at,
      opened_at,
      merchant_sentiment
    FROM tickets
    WHERE id = ?
    LIMIT 1
  `,
    [ticketId]
  )
  const current = rows[0]
  if (!current) {
    return NextResponse.json({ error: "Ticket not found." }, { status: 404 })
  }

  const updates: Array<{ column: string; value: string | null | number }> = []
  const history: Array<{ field: string; oldValue: string | null; newValue: string | null }> = []

  const compareAndPush = (
    field: string,
    column: string,
    oldValue: string | number | null,
    newValue: string | number | null
  ) => {
    const oldNormalized = oldValue == null ? null : String(oldValue)
    const newNormalized = newValue == null ? null : String(newValue)
    if (oldNormalized === newNormalized) {
      return
    }
    updates.push({ column, value: newNormalized })
    history.push({
      field,
      oldValue: oldNormalized,
      newValue: newNormalized,
    })
  }

  if (typeof body.status === "string") {
    compareAndPush("status", "status", current.status, body.status)
  }
  if (typeof body.hidden === "boolean") {
    compareAndPush(
      "hidden",
      "hidden",
      current.hidden ? "1" : "0",
      body.hidden ? "1" : "0"
    )
  }
  if (typeof body.merchantName === "string") {
    compareAndPush(
      "merchant_name",
      "merchant_name",
      current.merchant_name,
      body.merchantName
    )
  }
  if (typeof body.customerPhone === "string") {
    compareAndPush(
      "phone_number",
      "phone_number",
      current.phone_number,
      body.customerPhone
    )
  }

  const nextFid = typeof body.fid === "string" ? body.fid : current.fid ?? ""
  const nextOid = typeof body.oid === "string" ? body.oid : current.oid ?? ""

  if (typeof body.fid === "string") {
    compareAndPush("fid", "fid", current.fid, body.fid)
  }
  if (typeof body.oid === "string") {
    compareAndPush("oid", "oid", current.oid, body.oid)
  }

  if ((typeof body.fid === "string" || typeof body.oid === "string") && nextFid && nextOid) {
    const resolved = await resolveMerchantNames(pool, nextFid, nextOid)
    compareAndPush(
      "franchise_name_resolved",
      "franchise_name_resolved",
      current.franchise_name_resolved,
      resolved.franchiseName
    )
    compareAndPush(
      "outlet_name_resolved",
      "outlet_name_resolved",
      current.outlet_name_resolved,
      resolved.outletName
    )
  }
  if (typeof body.category === "string") {
    compareAndPush("issue_type", "issue_type", current.issue_type, body.category)
  }
  if (typeof body.subcategory1 === "string") {
    compareAndPush(
      "issue_subcategory1",
      "issue_subcategory1",
      current.issue_subcategory1,
      body.subcategory1
    )
  }
  if (body.subcategory2 !== undefined) {
    compareAndPush(
      "issue_subcategory2",
      "issue_subcategory2",
      current.issue_subcategory2,
      body.subcategory2 ?? null
    )
  }
  if (typeof body.issueDescription === "string") {
    compareAndPush(
      "issue_description",
      "issue_description",
      current.issue_description,
      body.issueDescription
    )
  }
  if (body.ticketDescription !== undefined) {
    compareAndPush(
      "ticket_description",
      "ticket_description",
      current.ticket_description,
      body.ticketDescription ?? null
    )
  }
  if (body.msPicUserId !== undefined) {
    compareAndPush(
      "ms_pic_user_id",
      "ms_pic_user_id",
      current.ms_pic_user_id,
      body.msPicUserId ?? null
    )
  }
  if (body.clickupTaskId !== undefined) {
    compareAndPush(
      "clickup_task_id",
      "clickup_task_id",
      current.clickup_task_id,
      body.clickupTaskId ?? null
    )
  }
  if (body.clickupLink !== undefined) {
    compareAndPush(
      "clickup_link",
      "clickup_link",
      current.clickup_link,
      body.clickupLink ?? null
    )
  }
  if (body.clickupTaskStatus !== undefined) {
    compareAndPush(
      "clickup_task_status",
      "clickup_task_status",
      current.clickup_task_status,
      body.clickupTaskStatus ?? null
    )
  }
  if (body.clickupTaskStatusSyncedAt !== undefined) {
    const normalizedSyncedAt = normalizeDateTimeForMysqlInput(
      body.clickupTaskStatusSyncedAt
    )
    compareAndPush(
      "clickup_task_status_synced_at",
      "clickup_task_status_synced_at",
      current.clickup_task_status_synced_at,
      normalizedSyncedAt
    )
  }
  if (body.openedAt !== undefined) {
    const normalizedOpenedAt = normalizeDateTimeForMysqlInput(body.openedAt)
    compareAndPush(
      "opened_at",
      "opened_at",
      current.opened_at,
      normalizedOpenedAt
    )
  }
  if (body.merchantSentiment !== undefined) {
    compareAndPush(
      "merchant_sentiment",
      "merchant_sentiment",
      current.merchant_sentiment,
      body.merchantSentiment ?? null
    )
  }

  if (!updates.length) {
    return NextResponse.json({ ok: true, updated: false })
  }

  const actorLabel = await getActorLabel(user.id)
  const setClauses: string[] = []
  const paramsList: Array<string | null | number> = []

  updates.forEach((item) => {
    setClauses.push(`${item.column} = ?`)
    paramsList.push(item.value)
  })

  const nextStatus = body.status ?? current.status
  setClauses.push("updated_by = ?")
  paramsList.push(actorLabel)

  const transitionedToClosed = isClosedStatus(nextStatus) && !isClosedStatus(current.status)

  if (transitionedToClosed) {
    setClauses.push("closed_at = NOW(3)")
  } else if (!isClosedStatus(nextStatus) && isClosedStatus(current.status)) {
    setClauses.push("closed_at = NULL")
  }

  await pool.query(
    `
    UPDATE tickets
    SET ${setClauses.join(", ")}
    WHERE id = ?
  `,
    [...paramsList, ticketId]
  )

  for (const item of history) {
    await pool.query(
      `
      INSERT INTO ticket_history (
        ticket_id,
        field_name,
        old_value,
        new_value,
        changed_by
      )
      VALUES (?, ?, ?, ?, ?)
    `,
      [ticketId, item.field, item.oldValue, item.newValue, actorLabel]
    )
  }

  let generatedCsatToken: string | null = null
  if (transitionedToClosed) {
    await pool.query(
      `
      UPDATE csat_tokens
      SET used_at = COALESCE(used_at, NOW(3))
      WHERE ticket_id = ?
        AND used_at IS NULL
    `,
      [ticketId]
    )

    generatedCsatToken = randomUUID()
    const tokenHash = hashOpaqueToken(generatedCsatToken)
    await pool.query(
      `
      INSERT INTO csat_tokens (ticket_id, token_hash, expires_at)
      VALUES (?, ?, DATE_ADD(NOW(3), INTERVAL 3 DAY))
    `,
      [ticketId, tokenHash]
    )

    await pool.query(
      `
      INSERT INTO ticket_history (
        ticket_id,
        field_name,
        old_value,
        new_value,
        changed_by
      )
      VALUES (?, 'csat_token_generated', NULL, ?, ?)
    `,
      [ticketId, "[generated]", actorLabel]
    )
  }

  return NextResponse.json({
    ok: true,
    updated: true,
    csatTokenGenerated: Boolean(generatedCsatToken),
  })
}
