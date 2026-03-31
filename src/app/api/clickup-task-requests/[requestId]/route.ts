import { NextRequest, NextResponse } from "next/server"
import type { RowDataPacket } from "mysql2"

import getPool from "@/lib/db"
import {
  clickupRequestSelectSql,
  mapClickupTaskRequest,
  parseRequestId,
  resolveAuthUser,
} from "../helpers"

type LinkedTicketRow = RowDataPacket & {
  id: string
  status: string
  merchant_name: string | null
  franchise_name_resolved: string | null
  outlet_name_resolved: string | null
  fid: string | null
  oid: string | null
  issue_type: string | null
  issue_subcategory1: string | null
  issue_subcategory2: string | null
  clickup_task_id: string | null
  clickup_link: string | null
  clickup_task_status: string | null
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ requestId: string }> }
) {
  const pool = getPool()
  const auth = await resolveAuthUser(request, pool)
  if ("response" in auth) {
    return auth.response
  }

  const { requestId } = await params
  const parsedId = parseRequestId(requestId)
  if (!parsedId) {
    return NextResponse.json({ error: "Invalid request id." }, { status: 400 })
  }

  const [rows] = await pool.query(
    `
    ${clickupRequestSelectSql}
    WHERE requests.id = ?
    LIMIT 1
  `,
    [parsedId]
  )

  const row = (rows as Parameters<typeof mapClickupTaskRequest>[0][])[0]
  if (!row) {
    return NextResponse.json({ error: "Request not found." }, { status: 404 })
  }

  const mapped = mapClickupTaskRequest(row)
  let ticket: null | {
    id: string
    status: string
    merchantName: string | null
    franchiseName: string | null
    outletName: string | null
    fid: string | null
    oid: string | null
    category: string | null
    subcategory1: string | null
    subcategory2: string | null
    clickupTaskId: string | null
    clickupLink: string | null
    clickupTaskStatus: string | null
  } = null

  if (row.ticket_id) {
    const [ticketRows] = await pool.query<LinkedTicketRow[]>(
      `
      SELECT
        id,
        status,
        merchant_name,
        franchise_name_resolved,
        outlet_name_resolved,
        fid,
        oid,
        issue_type,
        issue_subcategory1,
        issue_subcategory2,
        clickup_task_id,
        clickup_link,
        clickup_task_status
      FROM tickets
      WHERE id = ?
      LIMIT 1
    `,
      [row.ticket_id]
    )
    const linked = ticketRows[0]
    if (linked) {
      ticket = {
        id: String(linked.id),
        status: linked.status,
        merchantName: linked.merchant_name,
        franchiseName: linked.franchise_name_resolved,
        outletName: linked.outlet_name_resolved,
        fid: linked.fid,
        oid: linked.oid,
        category: linked.issue_type,
        subcategory1: linked.issue_subcategory1,
        subcategory2: linked.issue_subcategory2,
        clickupTaskId: linked.clickup_task_id,
        clickupLink: linked.clickup_link,
        clickupTaskStatus: linked.clickup_task_status,
      }
    }
  }

  return NextResponse.json({ request: mapped, ticket })
}
