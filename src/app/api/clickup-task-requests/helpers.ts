import type { Pool, RowDataPacket } from "mysql2/promise"
import { NextRequest, NextResponse } from "next/server"

import { resolveStoredObjectUrl } from "@/lib/storage"

export type AuthUser = {
  id: string
  name: string
  email: string
  role: string
}

type UserRow = RowDataPacket & {
  id: string
  name: string
  email: string
  role: string
  status: "active" | "inactive"
}

export type ClickupTaskRequestRow = RowDataPacket & {
  id: string
  ticket_id: string | null
  fid: string | null
  oid: string | null
  franchise_name: string | null
  product: string
  department_request: string
  outlet_name_resolved: string
  ms_pic: string
  priority_level: string
  severity_level: string
  incident_title: string
  task_description: string
  attachment_url: string | null
  attachment_url_2: string | null
  attachment_url_3: string | null
  status: "Pending Approval" | "Approved" | "Rejected"
  created_by_user_id: string | null
  created_by_email: string | null
  decision_reason: string | null
  decision_by_user_id: string | null
  decision_by_email: string | null
  decision_at: string | null
  clickup_task_id: string | null
  clickup_link: string | null
  created_at: string
  updated_at: string
  created_by_name: string | null
  decision_by_name: string | null
}

export const clickupRequestSelectSql = `
  SELECT
    requests.id,
    requests.ticket_id,
    requests.fid,
    requests.oid,
    requests.franchise_name,
    requests.product,
    requests.department_request,
    requests.outlet_name_resolved,
    requests.ms_pic,
    requests.priority_level,
    requests.severity_level,
    requests.incident_title,
    requests.task_description,
    requests.attachment_url,
    requests.attachment_url_2,
    requests.attachment_url_3,
    requests.status,
    requests.created_by_user_id,
    requests.created_by_email,
    requests.decision_reason,
    requests.decision_by_user_id,
    requests.decision_by_email,
    requests.decision_at,
    requests.clickup_task_id,
    requests.clickup_link,
    requests.created_at,
    requests.updated_at,
    created_by.name AS created_by_name,
    decision_by.name AS decision_by_name
  FROM clickup_task_requests AS requests
  LEFT JOIN users AS created_by
    ON created_by.id = requests.created_by_user_id
  LEFT JOIN users AS decision_by
    ON decision_by.id = requests.decision_by_user_id
`

export async function resolveAuthUser(
  request: NextRequest,
  pool: Pool
): Promise<{ user: AuthUser } | { response: NextResponse }> {
  const userId = request.headers.get("x-user-id")?.trim()
  if (!userId) {
    return {
      response: NextResponse.json({ error: "Unauthorized." }, { status: 401 }),
    }
  }

  const [rows] = await pool.query<UserRow[]>(
    `
    SELECT id, name, email, role, status
    FROM users
    WHERE id = ?
    LIMIT 1
  `,
    [userId]
  )

  const user = rows[0]
  if (!user || user.status !== "active") {
    return {
      response: NextResponse.json({ error: "Unauthorized." }, { status: 401 }),
    }
  }

  return {
    user: {
      id: String(user.id),
      name: user.name,
      email: user.email,
      role: user.role,
    },
  }
}

export function isAdminRole(role: string) {
  return role === "Admin" || role === "Super Admin"
}

export function parseRequestId(value: string) {
  const parsed = Number.parseInt(value, 10)
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null
  }
  return parsed
}

function cleanString(value: unknown) {
  if (typeof value !== "string") {
    return null
  }
  const trimmed = value.trim()
  return trimmed ? trimmed : null
}

export function parseStringArray(input: unknown, maxItems: number) {
  if (!Array.isArray(input)) {
    return []
  }
  const values = input
    .map((item) => cleanString(item))
    .filter((item): item is string => Boolean(item))
  return values.slice(0, maxItems)
}

export async function lookupTicketContext(pool: Pool, ticketId: number) {
  const [rows] = await pool.query<
    Array<
      RowDataPacket & {
        id: string
        fid: string | null
        oid: string | null
        franchise_name_resolved: string | null
        outlet_name_resolved: string | null
      }
    >
  >(
    `
    SELECT id, fid, oid, franchise_name_resolved, outlet_name_resolved
    FROM tickets
    WHERE id = ?
    LIMIT 1
  `,
    [ticketId]
  )
  return rows[0] ?? null
}

export function mapClickupTaskRequest(row: ClickupTaskRequestRow) {
  const attachments = [row.attachment_url, row.attachment_url_2, row.attachment_url_3]
    .map((value) => resolveStoredObjectUrl(value))
    .filter(Boolean) as string[]

  return {
    id: String(row.id),
    ticketId: row.ticket_id ? String(row.ticket_id) : null,
    fid: row.fid,
    oid: row.oid,
    franchiseName: row.franchise_name,
    product: row.product,
    departmentRequest: row.department_request,
    outletName: row.outlet_name_resolved,
    msPic: row.ms_pic,
    priorityLevel: row.priority_level,
    severityLevel: row.severity_level,
    incidentTitle: row.incident_title,
    taskDescription: row.task_description,
    attachments,
    status: row.status,
    createdByUserId: row.created_by_user_id ? String(row.created_by_user_id) : null,
    createdByEmail: row.created_by_email,
    createdByName: row.created_by_name,
    decisionReason: row.decision_reason,
    decisionByUserId: row.decision_by_user_id ? String(row.decision_by_user_id) : null,
    decisionByEmail: row.decision_by_email,
    decisionByName: row.decision_by_name,
    decisionAt: row.decision_at,
    clickupTaskId: row.clickup_task_id,
    clickupLink: row.clickup_link,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export function getSortClause(
  section: "pending" | "completed",
  sortBy: string | null,
  direction: string | null
) {
  const normalizedDirection = direction?.toLowerCase() === "asc" ? "ASC" : "DESC"

  if (section === "pending") {
    const columnMap: Record<string, string> = {
      created_at: "requests.created_at",
      priority_level: "requests.priority_level",
      severity_level: "requests.severity_level",
      incident_title: "requests.incident_title",
    }
    const column = columnMap[sortBy ?? ""] ?? "requests.created_at"
    return `${column} ${normalizedDirection}, requests.id DESC`
  }

  const columnMap: Record<string, string> = {
    decision_at: "requests.decision_at",
    created_at: "requests.created_at",
    status: "requests.status",
    priority_level: "requests.priority_level",
    severity_level: "requests.severity_level",
  }
  const column = columnMap[sortBy ?? ""] ?? "requests.decision_at"
  return `${column} ${normalizedDirection}, requests.id DESC`
}

export function validateCreatePayload(body: {
  product?: unknown
  departmentRequest?: unknown
  outletName?: unknown
  msPic?: unknown
  priorityLevel?: unknown
  severityLevel?: unknown
  incidentTitle?: unknown
  taskDescription?: unknown
}) {
  const product = cleanString(body.product)
  const departmentRequest = cleanString(body.departmentRequest) ?? "Merchant Success"
  const outletName = cleanString(body.outletName) ?? "Unknown outlet"
  const msPic = cleanString(body.msPic) ?? "--"
  const priorityLevel = cleanString(body.priorityLevel)
  const severityLevel = cleanString(body.severityLevel)
  const incidentTitle = cleanString(body.incidentTitle)
  const taskDescription = cleanString(body.taskDescription)

  if (!product || !priorityLevel || !severityLevel || !incidentTitle || !taskDescription) {
    return { error: "Missing required fields." as const }
  }

  return {
    product,
    departmentRequest,
    outletName,
    msPic,
    priorityLevel,
    severityLevel,
    incidentTitle,
    taskDescription,
  }
}
