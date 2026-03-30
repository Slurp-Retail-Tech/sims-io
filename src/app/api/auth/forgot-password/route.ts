import { NextRequest, NextResponse } from "next/server"

import getPool from "@/lib/db"
import { createOpaqueToken, normalizeEmail } from "@/lib/auth"
import {
  createStoredTokenRecord,
  sendResetPasswordEmail,
} from "@/lib/auth-email"

const genericResponse = {
  ok: true,
  message:
    "If that email is registered, a password reset link has been sent.",
}

export async function POST(request: NextRequest) {
  const body = (await request.json()) as { email?: string }
  const email = normalizeEmail(body.email)

  if (!email) {
    return NextResponse.json(genericResponse)
  }

  const pool = getPool()
  const [rows] = await pool.query(
    `
      SELECT id, name, email
      FROM users
      WHERE email = ?
        AND status = 'active'
      LIMIT 1
    `,
    [email]
  )

  const user = (rows as Array<{ id: string; name: string; email: string }>)[0]
  if (!user) {
    return NextResponse.json(genericResponse)
  }

  const connection = await pool.getConnection()
  const token = createOpaqueToken()
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000)
  let committed = false

  try {
    await connection.beginTransaction()
    await connection.query(
      `
        UPDATE auth_tokens
        SET consumed_at = CURRENT_TIMESTAMP(3)
        WHERE user_id = ?
          AND type = 'password_reset'
          AND consumed_at IS NULL
      `,
      [user.id]
    )
    await createStoredTokenRecord({
      connection,
      userId: user.id,
      type: "password_reset",
      token,
      expiresAt,
    })
    await connection.commit()
    committed = true

    await sendResetPasswordEmail({
      email: user.email,
      name: user.name,
      token,
      origin: request.nextUrl.origin,
    })
  } catch (error) {
    if (!committed) {
      await connection.rollback()
    }
    console.error(error)
  } finally {
    connection.release()
  }

  return NextResponse.json(genericResponse)
}
