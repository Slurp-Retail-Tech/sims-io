import { NextRequest, NextResponse } from "next/server"
import type { RowDataPacket } from "mysql2"

import { requireAuthenticatedUser } from "@/lib/auth"
import getPool from "@/lib/db"

type CsatTokenRow = RowDataPacket & {
  id: string
  token_hash: string
  expires_at: string
  used_at: string | null
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

  const [tokenRows] = await pool.query<CsatTokenRow[]>(
    `
    SELECT id, token_hash, expires_at, used_at
    FROM csat_tokens
    WHERE ticket_id = ?
    ORDER BY id DESC
    LIMIT 1
  `,
    [ticketId]
  )
  const token = tokenRows[0]
  if (!token) {
    return NextResponse.json({ error: "CSAT link is not available." }, { status: 400 })
  }

  const expiresAt = new Date(token.expires_at)
  const expired = Number.isNaN(expiresAt.valueOf()) || expiresAt.getTime() < Date.now()
  if (token.used_at || expired) {
    return NextResponse.json(
      { error: "CSAT link has expired or was already used." },
      { status: 400 }
    )
  }

  const actorLabel = await getActorLabel(user.id)
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

  return NextResponse.json({ ok: true })
}
