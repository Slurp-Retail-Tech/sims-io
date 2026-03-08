import { NextRequest, NextResponse } from "next/server"

import getPool from "@/lib/db"

export async function GET(request: NextRequest) {
  const userId = request.headers.get("x-user-id")?.trim()
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 })
  }

  const { searchParams } = new URL(request.url)
  const query = searchParams.get("q")?.trim().toLowerCase() ?? ""
  const limitParam = Number(searchParams.get("limit") ?? "50")
  const limit = Number.isFinite(limitParam) && limitParam > 0 ? limitParam : 50

  const whereClauses: string[] = []
  const values: Array<string> = []

  whereClauses.push(
    "COALESCE(CAST(JSON_UNQUOTE(JSON_EXTRACT(raw_payload, '$.closed_account')) AS CHAR), 'false') NOT IN ('true', '1')"
  )
  whereClauses.push(
    "COALESCE(CAST(JSON_UNQUOTE(JSON_EXTRACT(raw_payload, '$.test_account')) AS CHAR), 'false') NOT IN ('true', '1')"
  )

  if (query) {
    const likeValue = `%${query}%`
    whereClauses.push(
      `(LOWER(name) LIKE ? OR LOWER(fid) LIKE ? OR LOWER(CAST(raw_payload AS CHAR)) LIKE ?)`
    )
    values.push(likeValue, likeValue, likeValue)
  }

  const whereSql = whereClauses.length
    ? `WHERE ${whereClauses.join(" AND ")}`
    : ""

  const pool = getPool()
  const [rows] = await pool.query(
    `
    SELECT id, external_id, name, fid, raw_payload
    FROM merchants
    ${whereSql}
    ORDER BY name ASC
    LIMIT ?
  `,
    [...values, limit]
  )

  const merchants = (rows as Array<{
    id: string
    external_id: string
    name: string
    fid: string | null
    raw_payload: unknown
  }>).map((row) => {
    let payload: Record<string, unknown> | null = null
    if (typeof row.raw_payload === "string") {
      try {
        payload = JSON.parse(row.raw_payload) as Record<string, unknown>
      } catch {
        payload = null
      }
    } else if (row.raw_payload && typeof row.raw_payload === "object") {
      payload = row.raw_payload as Record<string, unknown>
    }

    return {
      id: row.id,
      name: row.name,
      fid: row.fid,
      externalId: row.external_id,
      company: payload?.company ?? null,
    }
  })

  return NextResponse.json({ merchants })
}
