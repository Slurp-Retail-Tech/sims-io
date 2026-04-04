import { NextRequest, NextResponse } from "next/server"

import getPool from "@/lib/db"
import {
  createOpaqueToken,
  hashPassword,
  normalizeEmail,
  requireAuthenticatedUser,
} from "@/lib/auth"
import {
  createStoredTokenRecord,
  sendActivationEmail,
} from "@/lib/auth-email"

const departments = [
  "Merchant Success",
  "Sales & Marketing",
  "Renewal & Retention",
  "Product & Engineering",
  "General Operation",
] as const
const roles = ["Super Admin", "Admin", "User"] as const
const validStatuses = new Set(["pending_activation", "active", "inactive"])

type Department = (typeof departments)[number]
type Role = (typeof roles)[number]
type UserStatus = "pending_activation" | "active" | "inactive"

const validDepartments = new Set<string>(departments)
const validRoles = new Set<string>(roles)

function isDepartment(value: string): value is Department {
  return validDepartments.has(value)
}

function isRole(value: string): value is Role {
  return validRoles.has(value)
}

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ userId: string }> }
) {
  const auth = await requireAuthenticatedUser(request)
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 })
  }
  if (auth.role === "User") {
    return NextResponse.json({ error: "Forbidden." }, { status: 403 })
  }

  const { userId } = await context.params
  const pool = getPool()
  const [rows] = await pool.query(
    `
      SELECT id, name, email, department, role, status
      FROM users
      WHERE id = ?
      LIMIT 1
    `,
    [userId]
  )

  const existing = (rows as Array<{
    id: string
    name: string
    email: string
    department: string
    role: Role
    status: UserStatus
  }>)[0]

  if (!existing) {
    return NextResponse.json({ error: "User not found." }, { status: 404 })
  }

  if (auth.role === "Admin" && existing.role === "Super Admin") {
    return NextResponse.json(
      { error: "Admins cannot update Super Admin users." },
      { status: 403 }
    )
  }

  const body = (await request.json()) as {
    action?: "resend-activation"
    name?: string
    email?: string
    department?: string
    role?: string
    password?: string
    status?: UserStatus
    pageAccess?: string[]
  }

  if (body.action === "resend-activation") {
    if (existing.status !== "pending_activation") {
      return NextResponse.json(
        { error: "Only pending users can receive a new activation email." },
        { status: 400 }
      )
    }

    const connection = await pool.getConnection()
    const token = createOpaqueToken()
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000)
    let committed = false

    try {
      await connection.beginTransaction()
      await connection.query(
        `
          UPDATE auth_tokens
          SET consumed_at = CURRENT_TIMESTAMP(3)
          WHERE user_id = ?
            AND type = 'activation'
            AND consumed_at IS NULL
        `,
        [userId]
      )
      await createStoredTokenRecord({
        connection,
        userId,
        type: "activation",
        token,
        expiresAt,
      })
      await connection.query(
        `
          UPDATE users
          SET invite_sent_at = CURRENT_TIMESTAMP(3), updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `,
        [userId]
      )
      await connection.commit()
      committed = true
      await sendActivationEmail({
        email: existing.email,
        name: existing.name,
        token,
        origin: request.nextUrl.origin,
      })
      return NextResponse.json({ ok: true })
    } catch (error) {
      if (!committed) {
        await connection.rollback()
      }
      console.error(error)
      return NextResponse.json(
        { error: "Unable to resend activation email." },
        { status: 500 }
      )
    } finally {
      connection.release()
    }
  }

  const updates: string[] = []
  const paramsList: Array<string> = []

  if (body.name?.trim()) {
    updates.push("name = ?")
    paramsList.push(body.name.trim())
  }

  if (body.email?.trim()) {
    updates.push("email = ?")
    paramsList.push(normalizeEmail(body.email))
  }

  if (body.department?.trim()) {
    if (!isDepartment(body.department)) {
      return NextResponse.json({ error: "Invalid department." }, { status: 400 })
    }
    updates.push("department = ?")
    paramsList.push(body.department)
  }

  if (body.role?.trim()) {
    if (!isRole(body.role)) {
      return NextResponse.json({ error: "Invalid role." }, { status: 400 })
    }
    if (auth.role === "Admin" && body.role === "Super Admin") {
      return NextResponse.json(
        { error: "Admins cannot assign Super Admin role." },
        { status: 403 }
      )
    }
    updates.push("role = ?")
    paramsList.push(body.role)
  }

  if (Array.isArray(body.pageAccess)) {
    updates.push("page_access = ?")
    paramsList.push(
      JSON.stringify(
        body.pageAccess.filter((value): value is string => typeof value === "string")
      )
    )
  }

  if (body.status) {
    if (!validStatuses.has(body.status)) {
      return NextResponse.json({ error: "Invalid status." }, { status: 400 })
    }
    if (body.status === "inactive" && auth.id === userId) {
      return NextResponse.json(
        { error: "You cannot deactivate your own account." },
        { status: 403 }
      )
    }
    updates.push("status = ?")
    paramsList.push(body.status)
    if (body.status === "active") {
      updates.push("activated_at = COALESCE(activated_at, CURRENT_TIMESTAMP(3))")
    }
  }

  if (body.password?.trim()) {
    if (body.password.trim().length < 12) {
      return NextResponse.json(
        { error: "Password must be at least 12 characters." },
        { status: 400 }
      )
    }
    updates.push("password_hash = ?")
    paramsList.push(hashPassword(body.password.trim()))
    updates.push("password_set_at = CURRENT_TIMESTAMP(3)")
  }

  if (updates.length === 0) {
    return NextResponse.json(
      { error: "No fields to update." },
      { status: 400 }
    )
  }

  try {
    await pool.query(
      `
        UPDATE users
        SET ${updates.join(", ")}, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `,
      [...paramsList, userId]
    )
  } catch (error) {
    const dbError = error as { code?: string }
    if (dbError.code === "ER_DUP_ENTRY") {
      return NextResponse.json(
        { error: "Email is already in use." },
        { status: 409 }
      )
    }
    console.error(error)
    return NextResponse.json(
      { error: "Unable to update user." },
      { status: 500 }
    )
  }

  return NextResponse.json({ ok: true })
}
