import { NextRequest, NextResponse } from "next/server"
import type { ResultSetHeader } from "mysql2/promise"

import getPool from "@/lib/db"
import { requireAuthenticatedUser } from "@/lib/auth"

type CategoryRow = {
  id: string
  name: string
  parent_id: string | null
  sort_order: number
}

type CategoryNode = {
  id: string
  name: string
  sortOrder: number
  subcategories: CategoryNode[]
}

const normalizeName = (value: unknown) => {
  if (typeof value !== "string") {
    return null
  }
  const trimmed = value.trim()
  return trimmed.length ? trimmed : null
}

function buildTree(rows: CategoryRow[]) {
  const grouped = new Map<string | null, CategoryRow[]>()
  rows.forEach((row) => {
    const key = row.parent_id ?? null
    if (!grouped.has(key)) {
      grouped.set(key, [])
    }
    grouped.get(key)?.push(row)
  })

  const buildLevel = (parentId: string | null): CategoryNode[] => {
    const items = grouped.get(parentId) ?? []
    return items.map((item) => ({
      id: item.id,
      name: item.name,
      sortOrder: item.sort_order,
      subcategories: buildLevel(item.id),
    }))
  }

  return buildLevel(null)
}

export async function GET(request: NextRequest) {
  const user = await requireAuthenticatedUser(request)
  if (!user) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 })
  }

  const pool = getPool()
  const [rows] = await pool.query(
    `
    SELECT id, name, parent_id, sort_order
    FROM ticket_categories
    ORDER BY sort_order ASC, name ASC
  `
  )

  const categories = buildTree(rows as CategoryRow[])

  return NextResponse.json({ categories })
}

export async function POST(request: NextRequest) {
  const user = await requireAuthenticatedUser(request)
  if (!user) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 })
  }

  const body = (await request.json()) as {
    name?: string
    parentId?: string | null
    sortOrder?: number
  }

  const name = normalizeName(body.name)
  if (!name) {
    return NextResponse.json({ error: "Name is required." }, { status: 400 })
  }

  const parentId = normalizeName(body.parentId) ?? null
  const sortOrder =
    typeof body.sortOrder === "number" && Number.isFinite(body.sortOrder)
      ? Math.trunc(body.sortOrder)
      : 0

  const pool = getPool()

  if (parentId) {
    const [parentRows] = await pool.query(
      `
      SELECT id
      FROM ticket_categories
      WHERE id = ?
      LIMIT 1
    `,
      [parentId]
    )
    if (!(parentRows as Array<{ id: string }>)[0]) {
      return NextResponse.json(
        { error: "Parent category not found." },
        { status: 404 }
      )
    }
  }

  const [insertResult] = await pool.query<ResultSetHeader>(
    `
    INSERT INTO ticket_categories (name, parent_id, sort_order)
    VALUES (?, ?, ?)
  `,
    [name, parentId, sortOrder]
  )
  const id = String(insertResult.insertId)

  return NextResponse.json({
    category: { id, name, parentId, sortOrder },
  })
}

export async function PATCH(request: NextRequest) {
  const user = await requireAuthenticatedUser(request)
  if (!user) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 })
  }

  const body = (await request.json()) as {
    id?: string
    name?: string
    sortOrder?: number
  }

  const id = normalizeName(body.id)
  if (!id) {
    return NextResponse.json({ error: "Category id is required." }, { status: 400 })
  }

  const updates: string[] = []
  const values: Array<string | number> = []

  if (body.name !== undefined) {
    const name = normalizeName(body.name)
    if (!name) {
      return NextResponse.json({ error: "Name is required." }, { status: 400 })
    }
    updates.push("name = ?")
    values.push(name)
  }

  if (body.sortOrder !== undefined) {
    const sortOrder =
      typeof body.sortOrder === "number" && Number.isFinite(body.sortOrder)
        ? Math.trunc(body.sortOrder)
        : 0
    updates.push("sort_order = ?")
    values.push(sortOrder)
  }

  if (!updates.length) {
    return NextResponse.json(
      { error: "No updates provided." },
      { status: 400 }
    )
  }

  values.push(id)
  const pool = getPool()
  await pool.query(
    `
    UPDATE ticket_categories
    SET ${updates.join(", ")}
    WHERE id = ?
  `,
    values
  )

  return NextResponse.json({ ok: true })
}

export async function DELETE(request: NextRequest) {
  const user = await requireAuthenticatedUser(request)
  if (!user) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 })
  }

  const { searchParams } = new URL(request.url)
  const id = normalizeName(searchParams.get("id"))
  if (!id) {
    return NextResponse.json({ error: "Category id is required." }, { status: 400 })
  }

  const pool = getPool()
  await pool.query(
    `
    DELETE FROM ticket_categories
    WHERE id = ?
       OR parent_id = ?
       OR parent_id IN (
        SELECT id FROM ticket_categories WHERE parent_id = ?
       )
  `,
    [id, id, id]
  )

  return NextResponse.json({ ok: true })
}
