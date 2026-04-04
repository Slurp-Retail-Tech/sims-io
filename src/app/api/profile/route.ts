import { NextRequest, NextResponse } from "next/server"

import getPool from "@/lib/db"
import {
  hashPassword,
  requireAuthenticatedUser,
  verifyPassword,
} from "@/lib/auth"

export async function GET(request: NextRequest) {
  const user = await requireAuthenticatedUser(request)
  if (!user) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 })
  }

  return NextResponse.json({
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      avatarUrl: user.avatarUrl,
      department: user.department,
      role: user.role,
      googleWorkspaceDomain: user.googleWorkspaceDomain,
    },
  })
}

export async function PATCH(request: NextRequest) {
  const user = await requireAuthenticatedUser(request)
  if (!user) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 })
  }

  const body = (await request.json()) as {
    name?: string
    currentPassword?: string
    newPassword?: string
    avatarUrl?: string | null
  }

  const updates: string[] = []
  const params: Array<string | null> = []

  if (body.name?.trim()) {
    updates.push("name = ?")
    params.push(body.name.trim())
  }

  if (typeof body.avatarUrl !== "undefined") {
    updates.push("avatar_url = ?")
    params.push(body.avatarUrl?.trim() || null)
  }

  if (body.newPassword) {
    if (body.newPassword.length < 12) {
      return NextResponse.json(
        { error: "Password must be at least 12 characters." },
        { status: 400 }
      )
    }
    if (!user.passwordHash) {
      return NextResponse.json(
        { error: "This account does not have a password set yet." },
        { status: 400 }
      )
    }
    if (!body.currentPassword) {
      return NextResponse.json(
        { error: "Current password is required." },
        { status: 400 }
      )
    }
    if (!verifyPassword(body.currentPassword, user.passwordHash)) {
      return NextResponse.json(
        { error: "Current password is incorrect." },
        { status: 403 }
      )
    }

    updates.push("password_hash = ?")
    params.push(hashPassword(body.newPassword))
    updates.push("password_set_at = CURRENT_TIMESTAMP(3)")
  }

  if (updates.length === 0) {
    return NextResponse.json(
      { error: "No fields to update." },
      { status: 400 }
    )
  }

  await getPool().query(
    `
      UPDATE users
      SET ${updates.join(", ")}, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `,
    [...params, user.id]
  )

  return NextResponse.json({ ok: true })
}
