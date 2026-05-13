import { NextRequest, NextResponse } from "next/server"
import type { ResultSetHeader } from "mysql2/promise"

import {
  createClickUpTask,
  type ClickUpCustomFieldInput,
  fetchClickUpListFields,
  type ClickUpListField,
  uploadClickUpTaskAttachment,
} from "@/lib/clickup"
import { applyClickUpSnapshotToTicket } from "@/lib/clickup-ticket-sync"
import getPool from "@/lib/db"
import {
  clickupRequestSelectSql,
  isAdminRole,
  mapClickupTaskRequest,
  parseRequestId,
  resolveAuthUser,
} from "../../helpers"

type Action = "approve" | "reject"

function resolveAttachmentUrl(raw: string, request: NextRequest) {
  try {
    return new URL(raw, request.url).toString()
  } catch {
    return null
  }
}

function resolveFilenameFromContentDisposition(header: string | null) {
  if (!header) {
    return null
  }
  const utf8Match = header.match(/filename\*=UTF-8''([^;]+)/i)
  if (utf8Match?.[1]) {
    const decoded = decodeURIComponent(utf8Match[1]).trim()
    if (decoded) {
      return decoded
    }
  }

  const plainMatch = header.match(/filename="?([^";]+)"?/i)
  if (plainMatch?.[1]) {
    const value = plainMatch[1].trim()
    if (value) {
      return value
    }
  }

  return null
}

function resolveFilenameFromUrl(url: URL, index: number) {
  const key = url.searchParams.get("key")?.trim()
  if (key) {
    const keySegments = key.split("/").filter(Boolean)
    const last = keySegments[keySegments.length - 1]
    if (last) {
      return decodeURIComponent(last)
    }
  }

  const segments = url.pathname.split("/").filter(Boolean)
  const last = segments[segments.length - 1]
  if (last && last !== "view") {
    return decodeURIComponent(last)
  }
  return `attachment-${index + 1}`
}

async function uploadRequestAttachmentsToClickUp(input: {
  taskId: string
  request: NextRequest
  attachments: Array<string | null | undefined>
}) {
  const values = input.attachments
    .map((value) => (value ? value.trim() : ""))
    .filter(Boolean)

  for (let index = 0; index < values.length; index += 1) {
    const raw = values[index]
    const resolvedUrl = resolveAttachmentUrl(raw, input.request)
    if (!resolvedUrl) {
      console.warn(`Skipping invalid attachment URL: ${raw}`)
      continue
    }

    try {
      const url = new URL(resolvedUrl)
      const fileResponse = await fetch(url)
      if (!fileResponse.ok) {
        throw new Error(`Unable to fetch file (${fileResponse.status})`)
      }

      const blob = await fileResponse.blob()
      const filename =
        resolveFilenameFromContentDisposition(
          fileResponse.headers.get("content-disposition")
        ) ?? resolveFilenameFromUrl(url, index)

      await uploadClickUpTaskAttachment({
        taskId: input.taskId,
        filename,
        file: blob,
      })
    } catch (error) {
      console.error("ClickUp attachment upload failed:", error)
    }
  }
}

function resolveCustomFieldId(envKey: string) {
  const value = process.env[envKey]?.trim()
  return value || null
}

function resolveMappedFieldValue(rawValue: string, mapEnvKey: string) {
  const mappingRaw = process.env[mapEnvKey]?.trim()
  if (!mappingRaw) {
    return rawValue
  }

  try {
    const parsed = JSON.parse(mappingRaw) as Record<string, unknown>
    const mapped = parsed[rawValue]
    if (
      typeof mapped === "string" ||
      typeof mapped === "number" ||
      typeof mapped === "boolean"
    ) {
      return mapped
    }
  } catch {
    // Fallback to raw value when mapping is not valid JSON.
  }

  return rawValue
}

function normalizeFieldOptionValue(value: string) {
  return value.trim().toLowerCase()
}

function resolveDropdownFieldValue(
  value: string | number | boolean,
  field: ClickUpListField
) {
  if (typeof value === "number") {
    return value
  }

  if (typeof value !== "string") {
    return null
  }

  const trimmed = value.trim()
  if (!trimmed) {
    return null
  }

  const byId = field.options.find((option) => option.id === trimmed)
  if (byId) {
    return byId.id
  }

  const normalized = normalizeFieldOptionValue(trimmed)
  const byName = field.options.find(
    (option) => normalizeFieldOptionValue(option.name) === normalized
  )
  if (byName) {
    return byName.id
  }

  const asIndex = Number.parseInt(trimmed, 10)
  if (Number.isFinite(asIndex)) {
    return asIndex
  }

  return null
}

function buildRequestCustomFields(
  item: {
  product: string
  department_request: string
  outlet_name_resolved: string
  ms_pic: string
  priority_level: string
  severity_level: string
  },
  listFields: ClickUpListField[]
) {
  const fields: ClickUpCustomFieldInput[] = []
  const listFieldMap = new Map(listFields.map((field) => [field.id, field]))

  const definitions: Array<{
    idEnv: string
    mapEnv?: string
    value: string
  }> = [
    {
      idEnv: "CLICKUP_CUSTOM_FIELD_PRODUCT_ID",
      mapEnv: "CLICKUP_CUSTOM_FIELD_PRODUCT_OPTION_MAP",
      value: item.product,
    },
    {
      idEnv: "CLICKUP_CUSTOM_FIELD_DEPARTMENT_REQUEST_ID",
      mapEnv: "CLICKUP_CUSTOM_FIELD_DEPARTMENT_REQUEST_OPTION_MAP",
      value: item.department_request,
    },
    {
      idEnv: "CLICKUP_CUSTOM_FIELD_OUTLET_NAME_ID",
      mapEnv: "CLICKUP_CUSTOM_FIELD_OUTLET_NAME_OPTION_MAP",
      value: item.outlet_name_resolved,
    },
    {
      idEnv: "CLICKUP_CUSTOM_FIELD_PIC_NAME_ID",
      mapEnv: "CLICKUP_CUSTOM_FIELD_PIC_NAME_OPTION_MAP",
      value: item.ms_pic,
    },
    {
      idEnv: "CLICKUP_CUSTOM_FIELD_PRIORITY_LEVEL_ID",
      mapEnv: "CLICKUP_CUSTOM_FIELD_PRIORITY_LEVEL_OPTION_MAP",
      value: item.priority_level,
    },
    {
      idEnv: "CLICKUP_CUSTOM_FIELD_SEVERITY_LEVEL_ID",
      mapEnv: "CLICKUP_CUSTOM_FIELD_SEVERITY_LEVEL_OPTION_MAP",
      value: item.severity_level,
    },
  ]

  for (const definition of definitions) {
    const fieldId = resolveCustomFieldId(definition.idEnv)
    if (!fieldId) {
      continue
    }
    const mappedValue = definition.mapEnv
      ? resolveMappedFieldValue(definition.value, definition.mapEnv)
      : definition.value
    const field = listFieldMap.get(fieldId)

    if (field?.options.length) {
      const dropdownValue = resolveDropdownFieldValue(mappedValue, field)
      if (dropdownValue === null) {
        console.warn(
          `Skipping ClickUp custom field ${fieldId}: value "${String(mappedValue)}" is not a valid option`
        )
        continue
      }
      fields.push({
        id: fieldId,
        value: dropdownValue,
      })
      continue
    }

    fields.push({
      id: fieldId,
      value: mappedValue,
    })
  }

  return fields
}

function buildClickUpName(item: {
  id: string
  incident_title: string
  outlet_name_resolved: string
}) {
  const title = item.incident_title.trim() || "Task request"
  const outlet = item.outlet_name_resolved.trim() || "Unknown outlet"
  return `${title} · ${outlet}`
}

function buildClickUpDescription(item: {
  id: string
  ticket_id: string | null
  product: string
  department_request: string
  outlet_name_resolved: string
  fid: string | null
  oid: string | null
  franchise_name: string | null
  ms_pic: string
  priority_level: string
  severity_level: string
  incident_title: string
  task_description: string
  created_by_email: string | null
}) {
  const ticketIdLabel = item.ticket_id ? `#${item.ticket_id}` : "-"

  return [
    `Ticket ID: ${ticketIdLabel}`,
    `Franchise: ${item.fid ?? "-"} / ${item.franchise_name ?? "-"}`,
    `Outlet: ${item.oid ?? "-"} / ${item.outlet_name_resolved || "-"}`,
    `Request ID: #${item.id}`,
    "--------------------",
    "",
    "Task Description:",
    item.task_description,
  ].join("\n")
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ requestId: string }> }
) {
  const pool = getPool()
  const auth = await resolveAuthUser(request, pool)
  if ("response" in auth) {
    return auth.response
  }

  if (!isAdminRole(auth.user.role)) {
    return NextResponse.json({ error: "Forbidden." }, { status: 403 })
  }

  const { requestId } = await params
  const parsedId = parseRequestId(requestId)
  if (!parsedId) {
    return NextResponse.json({ error: "Invalid request id." }, { status: 400 })
  }

  const body = (await request.json()) as { action?: unknown; reason?: unknown }
  const action = typeof body.action === "string" ? body.action.trim().toLowerCase() : ""
  const reason = typeof body.reason === "string" ? body.reason.trim() : ""

  if (action !== "approve" && action !== "reject") {
    return NextResponse.json({ error: "Invalid review action." }, { status: 400 })
  }
  if (!reason) {
    return NextResponse.json(
      { error: "Decision reason is required." },
      { status: 400 }
    )
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
  if (row.status !== "Pending Approval") {
    return NextResponse.json(
      { error: "Only pending requests can be reviewed." },
      { status: 409 }
    )
  }

  const nextStatus: "Approved" | "Rejected" =
    action === "approve" ? "Approved" : "Rejected"
  let clickupTaskId: string | null = null
  let clickupLink: string | null = null
  let clickupTaskStatus: string | null = null

  if ((action as Action) === "approve") {
    try {
      const listFields = await fetchClickUpListFields()
      const customFields = buildRequestCustomFields(row, listFields)
      const snapshot = await createClickUpTask({
        name: buildClickUpName(row),
        description: buildClickUpDescription(row),
        customFields,
      })
      await uploadRequestAttachmentsToClickUp({
        taskId: snapshot.taskId,
        request,
        attachments: [row.attachment_url, row.attachment_url_2, row.attachment_url_3],
      })
      clickupTaskId = snapshot.taskId
      clickupLink = snapshot.taskUrl
      clickupTaskStatus = snapshot.taskStatus
    } catch (error) {
      console.error(error)
      return NextResponse.json(
        {
          error:
            error instanceof Error
              ? error.message
              : "Unable to create ClickUp task.",
        },
        { status: 500 }
      )
    }
  }

  const [updateResult] = await pool.query<ResultSetHeader>(
    `
    UPDATE clickup_task_requests
    SET
      status = ?,
      decision_reason = ?,
      decision_by_user_id = ?,
      decision_by_email = ?,
      decision_at = CURRENT_TIMESTAMP(3),
      clickup_task_id = ?,
      clickup_link = ?
    WHERE id = ?
      AND status = 'Pending Approval'
  `,
    [
      nextStatus,
      reason,
      auth.user.id,
      auth.user.email,
      clickupTaskId,
      clickupLink,
      parsedId,
    ]
  )

  if (updateResult.affectedRows === 0) {
    return NextResponse.json(
      { error: "Request was already reviewed by another admin." },
      { status: 409 }
    )
  }

  if (nextStatus === "Approved" && row.ticket_id && clickupTaskId) {
    await applyClickUpSnapshotToTicket({
      ticketId: String(row.ticket_id),
      actorLabel: auth.user.name || auth.user.email || auth.user.id,
      taskId: clickupTaskId,
      taskUrl: clickupLink,
      taskStatus: clickupTaskStatus,
      syncedAt: new Date(),
    })
  }

  const [updatedRows] = await pool.query(
    `
    ${clickupRequestSelectSql}
    WHERE requests.id = ?
    LIMIT 1
  `,
    [parsedId]
  )

  const updated = (updatedRows as Parameters<typeof mapClickupTaskRequest>[0][])[0]
  return NextResponse.json({ request: mapClickupTaskRequest(updated) })
}
