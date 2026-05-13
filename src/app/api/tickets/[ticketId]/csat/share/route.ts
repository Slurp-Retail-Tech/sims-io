import { randomUUID } from "node:crypto"
import { NextRequest, NextResponse } from "next/server"
import type { ResultSetHeader, RowDataPacket } from "mysql2"

import { hashOpaqueToken, requireAuthenticatedUser } from "@/lib/auth"
import {
  getCsatReferenceColumn,
  getCsatTokenColumn,
  getCsatTokenSelectExpressions,
  getCsatTokenStorageValue,
} from "@/lib/csat-schema"
import getPool from "@/lib/db"

type CsatTokenRow = RowDataPacket & {
  id: string
  token: string | null
  token_hash: string
  expires_at: string
  used_at: string | null
}

type TicketRow = RowDataPacket & {
  id: string
  status: string
}

type InsertedTokenRow = RowDataPacket & {
  expires_at: string
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

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ ticketId: string }> }
) {
  const user = await requireAuthenticatedUser(request)
  if (!user) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 })
  }

  const { ticketId } = await params
  const pool = getPool()
  const [ticketRows] = await pool.query<TicketRow[]>(
    "SELECT id, status FROM tickets WHERE id = ? LIMIT 1",
    [ticketId]
  )
  const ticket = ticketRows[0]
  if (!ticket) {
    return NextResponse.json({ error: "Ticket not found." }, { status: 404 })
  }
  if (ticket.status !== "Resolved") {
    return NextResponse.json(
      { error: "CSAT link can only be shared for resolved tickets." },
      { status: 400 }
    )
  }

  const [csatTokenTicketColumn, csatTokenColumn] = await Promise.all([
    getCsatReferenceColumn(pool, "csat_tokens"),
    getCsatTokenColumn(pool),
  ])
  const csatTokenSelectExpressions = getCsatTokenSelectExpressions(csatTokenColumn)

  const [tokenRows] = await pool.query<CsatTokenRow[]>(
    `
    SELECT id, ${csatTokenSelectExpressions}, expires_at, used_at
    FROM csat_tokens
    WHERE ${csatTokenTicketColumn} = ?
    ORDER BY id DESC
    LIMIT 1
  `,
    [ticketId]
  )
  const token = tokenRows[0] ?? null
  let rawToken = token?.token ?? null
  let expiresAt = token?.expires_at ?? null
  let generated = false

  const tokenExpiresAt = token ? new Date(token.expires_at) : null
  const hasReusableToken =
    Boolean(token?.token) &&
    !token?.used_at &&
    tokenExpiresAt !== null &&
    !Number.isNaN(tokenExpiresAt.valueOf()) &&
    tokenExpiresAt.getTime() >= Date.now()

  if (!hasReusableToken) {
    await pool.query(
      `
      UPDATE csat_tokens
      SET used_at = COALESCE(used_at, NOW(3))
      WHERE ${csatTokenTicketColumn} = ?
        AND used_at IS NULL
    `,
      [ticketId]
    )

    rawToken = randomUUID()
    const tokenHash = hashOpaqueToken(rawToken)
    const tokenValue = getCsatTokenStorageValue(csatTokenColumn, rawToken, tokenHash)
    const [insertResult] = await pool.query<ResultSetHeader>(
      `
      INSERT INTO csat_tokens (${csatTokenTicketColumn}, ${csatTokenColumn}, expires_at)
      VALUES (?, ?, DATE_ADD(NOW(3), INTERVAL 3 DAY))
    `,
      [ticketId, tokenValue]
    )

    const [insertedRows] = await pool.query<InsertedTokenRow[]>(
      `
      SELECT expires_at
      FROM csat_tokens
      WHERE id = ?
      LIMIT 1
    `,
      [insertResult.insertId]
    )
    expiresAt = insertedRows[0]?.expires_at ?? null
    generated = true
  }

  if (!rawToken || !expiresAt) {
    return NextResponse.json({ error: "Unable to create CSAT link." }, { status: 500 })
  }

  const actorLabel = await getActorLabel(user.id)
  if (generated) {
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

  await pool.query(
    `
    INSERT INTO ticket_history (
      ticket_id,
      field_name,
      old_value,
      new_value,
      changed_by
    )
    VALUES (?, 'csat_link_shared', NULL, NOW(3), ?)
  `,
    [ticketId, actorLabel]
  )

  return NextResponse.json({ ok: true, token: rawToken, expiresAt, generated })
}
