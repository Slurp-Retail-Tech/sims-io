import { NextRequest, NextResponse } from "next/server"
import type { RowDataPacket } from "mysql2"

import getPool from "@/lib/db"

type HistoryRow = RowDataPacket & {
  id: string
  field_name: string
  old_value: string | null
  new_value: string | null
  changed_at: string
  changed_by: string | null
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ ticketId: string }> }
) {
  const userId = request.headers.get("x-user-id")?.trim()
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 })
  }

  const { ticketId } = await params
  const pool = getPool()

  const [rows] = await pool.query<HistoryRow[]>(
    `
    SELECT id, field_name, old_value, new_value, changed_at, changed_by
    FROM ticket_history
    WHERE ticket_id = ?
    ORDER BY changed_at DESC, id DESC
  `,
    [ticketId]
  )

  const userReferenceIds = Array.from(
    new Set(
      rows
        .flatMap((row) => {
          const refs: Array<string | null> = [row.changed_by]
          if (row.field_name === "ms_pic_user_id" || row.field_name === "updated_by") {
            refs.push(row.old_value, row.new_value)
          }
          return refs
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
      id: row.id,
      field: row.field_name,
      oldValue:
        row.field_name === "ms_pic_user_id" || row.field_name === "updated_by"
          ? row.old_value
            ? (userNameMap.get(row.old_value) ?? row.old_value)
            : null
          : row.old_value,
      newValue:
        row.field_name === "ms_pic_user_id" || row.field_name === "updated_by"
          ? row.new_value
            ? (userNameMap.get(row.new_value) ?? row.new_value)
            : null
          : row.new_value,
      changedAt: row.changed_at,
      changedBy: row.changed_by
        ? (userNameMap.get(row.changed_by) ?? row.changed_by)
        : null,
    })),
  })
}
