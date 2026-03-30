import { NextRequest, NextResponse } from "next/server"
import type { ResultSetHeader } from "mysql2/promise"

import getPool from "@/lib/db"
import {
  createOpaqueToken,
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

export async function GET(request: NextRequest) {
  const auth = await requireAuthenticatedUser(request)
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 })
  }
  if (auth.role === "User") {
    return NextResponse.json({ error: "Forbidden." }, { status: 403 })
  }

  const pool = getPool()
  const includeInactive =
    request.nextUrl.searchParams.get("includeInactive") === "true"

  const conditions: string[] = []
  if (!includeInactive) {
    conditions.push("status <> 'inactive'")
  }

  const whereClause = conditions.length
    ? `WHERE ${conditions.join(" AND ")}`
    : ""

  const [rows] = await pool.query(
    `
      SELECT id, name, email, department, role, status, page_access, created_at, updated_at
      FROM users
      ${whereClause}
      ORDER BY created_at DESC
    `
  )

  const users = (rows as Array<{
    id: string
    name: string
    email: string
    department: string
    role: string
    status: UserStatus
    page_access: unknown
    created_at: string
    updated_at: string
  }>).map((row) => ({
    ...row,
    pageAccess: Array.isArray(row.page_access)
      ? row.page_access.filter((value): value is string => typeof value === "string")
      : typeof row.page_access === "string"
        ? (() => {
            try {
              const parsed = JSON.parse(row.page_access)
              return Array.isArray(parsed)
                ? parsed.filter((value): value is string => typeof value === "string")
                : []
            } catch {
              return []
            }
          })()
        : [],
  }))

  return NextResponse.json({ users })
}

export async function POST(request: NextRequest) {
  const auth = await requireAuthenticatedUser(request)
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 })
  }
  if (auth.role === "User") {
    return NextResponse.json({ error: "Forbidden." }, { status: 403 })
  }

  const body = (await request.json()) as {
    name?: string
    email?: string
    department?: string
    role?: string
    pageAccess?: string[]
  }

  const name = body.name?.trim()
  const email = normalizeEmail(body.email)
  const department = body.department?.trim()
  const role = body.role?.trim()

  if (!name || !email || !department || !role) {
    return NextResponse.json(
      { error: "Missing required fields." },
      { status: 400 }
    )
  }

  if (!isDepartment(department) || !isRole(role)) {
    return NextResponse.json(
      { error: "Invalid role or department." },
      { status: 400 }
    )
  }

  if (auth.role === "Admin" && role === "Super Admin") {
    return NextResponse.json(
      { error: "Admins cannot create Super Admin users." },
      { status: 403 }
    )
  }

  const pageAccess = Array.isArray(body.pageAccess)
    ? body.pageAccess.filter((value): value is string => typeof value === "string")
    : []

  const pool = getPool()
  const connection = await pool.getConnection()
  const token = createOpaqueToken()
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000)
  let committed = false

  try {
    await connection.beginTransaction()

    const [insertResult] = await connection.query<ResultSetHeader>(
      `
        INSERT INTO users (
          name,
          email,
          department,
          role,
          status,
          password_hash,
          page_access,
          invite_sent_at
        )
        VALUES (?, ?, ?, ?, 'pending_activation', NULL, ?, CURRENT_TIMESTAMP(3))
      `,
      [name, email, department, role, JSON.stringify(pageAccess)]
    )

    const userId = String(insertResult.insertId)
    await createStoredTokenRecord({
      connection,
      userId,
      type: "activation",
      token,
      expiresAt,
    })

    await connection.commit()
    committed = true

    await sendActivationEmail({
      email,
      name,
      token,
      origin: request.nextUrl.origin,
    })

    return NextResponse.json({
      user: {
        id: userId,
        name,
        email,
        department,
        role,
        status: "pending_activation" as UserStatus,
        pageAccess,
      },
    })
  } catch (error) {
    if (!committed) {
      await connection.rollback()
    }
    const dbError = error as { code?: string }
    if (dbError.code === "ER_DUP_ENTRY") {
      return NextResponse.json(
        { error: "Email is already in use." },
        { status: 409 }
      )
    }
    console.error(error)
    return NextResponse.json(
      { error: "Unable to create user." },
      { status: 500 }
    )
  } finally {
    connection.release()
  }
}
