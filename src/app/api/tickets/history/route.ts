import { NextRequest, NextResponse } from "next/server"
import type { RowDataPacket } from "mysql2"

import getPool from "@/lib/db"

type AuditHistoryRow = RowDataPacket & {
  id: string | number
  ticket_id: string | number
  field_name: string
  old_value: string | null
  new_value: string | null
  changed_at: string
  changed_by_display: string | null
}

export async function GET(request: NextRequest) {
  const userId = request.headers.get("x-user-id")?.trim()
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 })
  }

  const { searchParams } = new URL(request.url)
  const ticketId = searchParams.get("ticket_id")?.trim() ?? ""
  const startDate = searchParams.get("start_date")?.trim() ?? ""
  const endDate = searchParams.get("end_date")?.trim() ?? ""
  const pageParam = Number(searchParams.get("page") ?? "1")
  const perPageParam = Number(searchParams.get("per_page") ?? "25")

  const allowedPerPage = new Set([10, 25, 50, 100])
  const page = Number.isFinite(pageParam) && pageParam > 0 ? pageParam : 1
  const perPage = allowedPerPage.has(perPageParam) ? perPageParam : 25
  const offset = (page - 1) * perPage

  const whereClauses: string[] = []
  const values: Array<string | number> = []

  if (ticketId) {
    whereClauses.push("CAST(history.request_id AS CHAR) LIKE ?")
    values.push(`%${ticketId}%`)
  }

  if (startDate) {
    whereClauses.push("DATE(history.changed_at) >= ?")
    values.push(startDate)
  }

  if (endDate) {
    whereClauses.push("DATE(history.changed_at) <= ?")
    values.push(endDate)
  }

  const whereSql = whereClauses.length
    ? `WHERE ${whereClauses.join(" AND ")}`
    : ""

  const pool = getPool()

  const [countRows] = await pool.query<RowDataPacket[]>(
    `
    SELECT COUNT(*) AS total
    FROM support_request_history AS history
    ${whereSql}
  `,
    values
  )

  const totalValue = countRows[0]?.total ?? 0
  const total =
    typeof totalValue === "string" ? Number.parseInt(totalValue, 10) : totalValue

  const [rows] = await pool.query<AuditHistoryRow[]>(
    `
    SELECT
      history.id,
      history.request_id AS ticket_id,
      history.field_name,
      history.old_value,
      history.new_value,
      history.changed_at,
      COALESCE(actor.name, actor.email, history.changed_by) AS changed_by_display
    FROM support_request_history AS history
    LEFT JOIN users AS actor
      ON actor.id = history.changed_by
    ${whereSql}
    ORDER BY history.changed_at DESC, history.id DESC
    LIMIT ? OFFSET ?
  `,
    [...values, perPage, offset]
  )

  const userReferenceIds = Array.from(
    new Set(
      rows
        .flatMap((row) => {
          if (row.field_name !== "ms_pic_user_id") {
            return []
          }
          return [row.old_value, row.new_value]
        })
        .filter((value): value is string => Boolean(value))
    )
  )

  let userNameMap = new Map<string, string>()
  if (userReferenceIds.length) {
    const placeholders = userReferenceIds.map(() => "?").join(", ")
    const [userRows] = await pool.query<RowDataPacket[]>(
      `
      SELECT id, name
      FROM users
      WHERE id IN (${placeholders})
    `,
      userReferenceIds
    )
    userNameMap = new Map(
      userRows.map((row) => [String(row.id), String(row.name ?? row.id)])
    )
  }

  return NextResponse.json({
    history: rows.map((row) => ({
      id: String(row.id),
      ticketId: String(row.ticket_id),
      field: row.field_name,
      oldValue:
        row.field_name === "ms_pic_user_id"
          ? row.old_value
            ? (userNameMap.get(row.old_value) ?? row.old_value)
            : null
          : row.old_value,
      newValue:
        row.field_name === "ms_pic_user_id"
          ? row.new_value
            ? (userNameMap.get(row.new_value) ?? row.new_value)
            : null
          : row.new_value,
      changedAt: row.changed_at,
      changedBy: row.changed_by_display,
    })),
    total,
    page,
    perPage,
  })
}
