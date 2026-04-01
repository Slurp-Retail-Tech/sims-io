import { NextRequest, NextResponse } from "next/server"
import type { ResultSetHeader } from "mysql2"

import getPool from "@/lib/db"
import { requireAuthenticatedUser } from "@/lib/auth"

type ArchiveBody = {
  archived?: boolean
}

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ leadId: string }> }
) {
  const user = await requireAuthenticatedUser(request)
  if (!user) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 })
  }

  const { leadId } = await context.params
  const parsedLeadId = Number(leadId)
  if (!Number.isInteger(parsedLeadId) || parsedLeadId <= 0) {
    return NextResponse.json({ error: "Invalid lead id." }, { status: 400 })
  }

  let body: ArchiveBody
  try {
    body = (await request.json()) as ArchiveBody
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 })
  }

  if (typeof body.archived !== "boolean") {
    return NextResponse.json({ error: "Field 'archived' is required." }, { status: 400 })
  }

  const pool = getPool()
  const [result] = await pool.query<ResultSetHeader>(
    `
      UPDATE leads
      SET archived = ?, updated_at = CURRENT_TIMESTAMP(3)
      WHERE id = ?
    `,
    [body.archived, parsedLeadId]
  )

  if (result.affectedRows === 0) {
    return NextResponse.json({ error: "Lead not found." }, { status: 404 })
  }

  return NextResponse.json({ ok: true })
}
