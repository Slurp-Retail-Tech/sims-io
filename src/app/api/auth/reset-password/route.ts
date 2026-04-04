import { NextRequest, NextResponse } from "next/server"

import getPool from "@/lib/db"
import { hashOpaqueToken, hashPassword } from "@/lib/auth"

export async function POST(request: NextRequest) {
  const body = (await request.json()) as { token?: string; password?: string }
  const token = body.token?.trim() ?? ""
  const password = body.password?.trim() ?? ""

  if (!token || !password) {
    return NextResponse.json(
      { error: "Token and password are required." },
      { status: 400 }
    )
  }
  if (password.length < 12) {
    return NextResponse.json(
      { error: "Password must be at least 12 characters." },
      { status: 400 }
    )
  }

  const pool = getPool()
  const connection = await pool.getConnection()

  try {
    await connection.beginTransaction()
    const [rows] = await connection.query(
      `
        SELECT auth_tokens.id, auth_tokens.user_id, users.status
        FROM auth_tokens
        INNER JOIN users ON users.id = auth_tokens.user_id
        WHERE auth_tokens.token_hash = ?
          AND auth_tokens.type = 'password_reset'
          AND auth_tokens.consumed_at IS NULL
          AND auth_tokens.expires_at > CURRENT_TIMESTAMP(3)
        LIMIT 1
        FOR UPDATE
      `,
      [hashOpaqueToken(token)]
    )

    const record = (
      rows as Array<{ id: string; user_id: string; status: string }>
    )[0]

    if (!record || record.status !== "active") {
      await connection.rollback()
      return NextResponse.json(
        { error: "This reset link is invalid or has expired." },
        { status: 400 }
      )
    }

    await connection.query(
      `
        UPDATE users
        SET password_hash = ?, password_set_at = CURRENT_TIMESTAMP(3), updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `,
      [hashPassword(password), record.user_id]
    )
    await connection.query(
      `
        UPDATE auth_tokens
        SET consumed_at = CURRENT_TIMESTAMP(3)
        WHERE id = ?
      `,
      [record.id]
    )
    await connection.query(
      `DELETE FROM sessions WHERE user_id = ?`,
      [record.user_id]
    )
    await connection.commit()
  } catch (error) {
    await connection.rollback()
    console.error(error)
    return NextResponse.json(
      { error: "Unable to reset password." },
      { status: 500 }
    )
  } finally {
    connection.release()
  }

  return NextResponse.json({ ok: true })
}
