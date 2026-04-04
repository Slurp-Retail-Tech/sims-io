import { NextRequest, NextResponse } from "next/server"
import type { RowDataPacket } from "mysql2"

import { hashOpaqueToken } from "@/lib/auth"
import getPool from "@/lib/db"
import { checkRateLimit } from "@/lib/rate-limit"

type TokenRow = RowDataPacket & {
  id: string
  ticket_id: string
  token_hash: string
  expires_at: string
  used_at: string | null
  created_at: string
  merchant_name: string | null
  phone_number: string | null
  franchise_name_resolved: string | null
  outlet_name_resolved: string | null
}

type ResponseRow = RowDataPacket & {
  id: string
  submitted_at: string
}

function getTokenStatus(token: TokenRow, response: ResponseRow | null) {
  if (response || token.used_at) {
    return "submitted"
  }
  const expiresAt = new Date(token.expires_at)
  if (Number.isNaN(expiresAt.valueOf()) || expiresAt.getTime() < Date.now()) {
    return "expired"
  }
  return "active"
}

export async function GET(
  _: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params
  const tokenHash = hashOpaqueToken(token)
  const pool = getPool()

  const [tokenRows] = await pool.query<TokenRow[]>(
    `
    SELECT
      csat_tokens.id,
      csat_tokens.ticket_id,
      csat_tokens.token_hash,
      csat_tokens.expires_at,
      csat_tokens.used_at,
      csat_tokens.created_at,
      tickets.merchant_name,
      tickets.phone_number,
      tickets.franchise_name_resolved,
      tickets.outlet_name_resolved
    FROM csat_tokens
    INNER JOIN tickets
      ON tickets.id = csat_tokens.ticket_id
    WHERE csat_tokens.token_hash = ?
    LIMIT 1
  `,
    [tokenHash]
  )
  const tokenRow = tokenRows[0]
  if (!tokenRow) {
    return NextResponse.json({ error: "CSAT link not found." }, { status: 404 })
  }

  const [responseRows] = await pool.query<ResponseRow[]>(
    `
    SELECT id, submitted_at
    FROM csat_responses
    WHERE token_id = ?
    LIMIT 1
  `,
    [tokenRow.id]
  )
  const latestResponse = responseRows[0] ?? null
  const status = getTokenStatus(tokenRow, latestResponse)

  return NextResponse.json({
    status,
    ticket: {
      id: tokenRow.ticket_id,
      merchantName: tokenRow.merchant_name,
      phoneNumber: tokenRow.phone_number,
      franchiseName: tokenRow.franchise_name_resolved,
      outletName: tokenRow.outlet_name_resolved,
    },
    token: {
      createdAt: tokenRow.created_at,
      expiresAt: tokenRow.expires_at,
      usedAt: tokenRow.used_at,
      submittedAt: latestResponse?.submitted_at ?? null,
    },
  })
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params
  const rateLimit = await checkRateLimit(`csat:submit:${token}`, 10, 300)
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: "Too many requests. Please try again later." },
      { status: 429 }
    )
  }

  const tokenHash = hashOpaqueToken(token)
  const body = (await request.json()) as {
    supportScore?: string
    supportReason?: string | null
    productScore?: string
    productFeedback?: string | null
  }

  const supportScore = (body.supportScore ?? "").trim()
  const productScore = (body.productScore ?? "").trim()
  const supportReason = body.supportReason?.trim() ?? null
  const productFeedback = body.productFeedback?.trim() ?? null

  if (!supportScore || !productScore) {
    return NextResponse.json({ error: "Scores are required." }, { status: 400 })
  }

  const pool = getPool()
  const [tokenRows] = await pool.query<TokenRow[]>(
    `
    SELECT id, ticket_id, token_hash, expires_at, used_at, created_at
    FROM csat_tokens
    WHERE token_hash = ?
    LIMIT 1
  `,
    [tokenHash]
  )
  const tokenRow = tokenRows[0]
  if (!tokenRow) {
    return NextResponse.json({ error: "CSAT link not found." }, { status: 404 })
  }

  const [responseRows] = await pool.query<ResponseRow[]>(
    `
    SELECT id, submitted_at
    FROM csat_responses
    WHERE token_id = ?
    LIMIT 1
  `,
    [tokenRow.id]
  )
  const latestResponse = responseRows[0] ?? null
  const status = getTokenStatus(tokenRow, latestResponse)
  if (status !== "active") {
    return NextResponse.json(
      { error: "CSAT link has expired or was already used.", status },
      { status: 400 }
    )
  }

  await pool.query(
    `
    INSERT INTO csat_responses (
      ticket_id,
      token_id,
      support_score,
      support_reason,
      product_score,
      product_feedback
    )
    VALUES (?, ?, ?, ?, ?, ?)
  `,
    [
      tokenRow.ticket_id,
      tokenRow.id,
      supportScore,
      supportReason,
      productScore,
      productFeedback,
    ]
  )

  await pool.query(
    `
    UPDATE csat_tokens
    SET used_at = NOW(3)
    WHERE id = ?
  `,
    [tokenRow.id]
  )

  return NextResponse.json({ ok: true })
}
