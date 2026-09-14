import { httpFetch } from "./http.ts"

export type ClickUpTaskSnapshot = {
  taskId: string
  taskUrl: string | null
  taskStatus: string | null
}

export type ClickUpCustomFieldInput = {
  id: string
  value: string | number | boolean
}

export type ClickUpListFieldOption = {
  id: string
  name: string
}

export type ClickUpListField = {
  id: string
  name: string
  type: string
  options: ClickUpListFieldOption[]
}

const DEFAULT_CLICKUP_API_BASE_URL = "https://api.clickup.com/api/v2"

function resolveClickUpToken() {
  const token = process.env.CLICKUP_API_TOKEN?.trim()
  if (!token) {
    throw new Error("CLICKUP_API_TOKEN is required")
  }
  return token
}

function resolveClickUpListId() {
  const listId = process.env.CLICKUP_LIST_ID?.trim()
  if (!listId) {
    throw new Error("CLICKUP_LIST_ID is required")
  }
  return listId
}

function resolveClickUpApiBaseUrl() {
  const value = process.env.CLICKUP_API_BASE_URL?.trim()
  return value || DEFAULT_CLICKUP_API_BASE_URL
}

function getTaskUrl(raw: unknown, taskId: string) {
  if (raw && typeof raw === "object") {
    const record = raw as Record<string, unknown>
    if (typeof record.url === "string" && record.url.trim()) {
      return record.url.trim()
    }
  }
  return `https://app.clickup.com/t/${encodeURIComponent(taskId)}`
}

function getTaskStatus(raw: unknown) {
  if (!raw || typeof raw !== "object") {
    return null
  }
  const status = (raw as Record<string, unknown>).status
  if (!status || typeof status !== "object") {
    return null
  }
  const statusRecord = status as Record<string, unknown>
  const name = statusRecord.status ?? statusRecord.name
  return typeof name === "string" && name.trim() ? name.trim() : null
}

function getTaskId(raw: unknown) {
  if (!raw || typeof raw !== "object") {
    return null
  }
  const id = (raw as Record<string, unknown>).id
  return typeof id === "string" && id.trim() ? id.trim() : null
}

async function parseResponse(response: Response) {
  try {
    return (await response.json()) as unknown
  } catch {
    return null
  }
}

function getErrorMessage(payload: unknown) {
  if (!payload || typeof payload !== "object") {
    return null
  }
  const record = payload as Record<string, unknown>
  const message = record.err ?? record.error ?? record.message
  return typeof message === "string" && message.trim() ? message.trim() : null
}

/** Ceiling for ordinary ClickUp API calls. */
const CLICKUP_TIMEOUT_MS = 10_000

/** Attachment uploads carry a file body, so they get a longer budget. */
const CLICKUP_UPLOAD_TIMEOUT_MS = 20_000

function getHeaders() {
  return {
    Authorization: resolveClickUpToken(),
    "Content-Type": "application/json",
  }
}

function getAuthHeaders() {
  return {
    Authorization: resolveClickUpToken(),
  }
}

export function extractClickUpTaskIdFromLink(link: string | null | undefined) {
  const value = (link ?? "").trim()
  if (!value) {
    return null
  }
  const match = value.match(/\/t\/([^/?#]+)/i)
  if (!match) {
    return null
  }
  const id = match[1]?.trim()
  return id || null
}

export async function createClickUpTask(input: {
  name: string
  description: string
  customFields?: ClickUpCustomFieldInput[]
}) {
  const listId = resolveClickUpListId()
  const endpoint = `${resolveClickUpApiBaseUrl()}/list/${encodeURIComponent(listId)}/task`

  const response = await httpFetch(endpoint, {
    method: "POST",
    headers: getHeaders(),
    label: "clickup.createTask",
    timeoutMs: CLICKUP_TIMEOUT_MS,
    body: JSON.stringify({
      name: input.name,
      description: input.description,
      custom_fields: input.customFields?.length
        ? input.customFields.map((field) => ({ id: field.id, value: field.value }))
        : undefined,
    }),
  })

  const payload = await parseResponse(response)
  if (!response.ok) {
    throw new Error(
      getErrorMessage(payload) || `ClickUp task creation failed (${response.status})`
    )
  }

  const taskId = getTaskId(payload)
  if (!taskId) {
    throw new Error("ClickUp task creation succeeded but task id was missing")
  }

  return {
    taskId,
    taskUrl: getTaskUrl(payload, taskId),
    taskStatus: getTaskStatus(payload),
  } satisfies ClickUpTaskSnapshot
}

export async function uploadClickUpTaskAttachment(input: {
  taskId: string
  filename: string
  file: Blob
}) {
  const normalizedTaskId = input.taskId.trim()
  if (!normalizedTaskId) {
    throw new Error("ClickUp task id is required for attachment upload")
  }

  const endpoint = `${resolveClickUpApiBaseUrl()}/task/${encodeURIComponent(normalizedTaskId)}/attachment`
  const formData = new FormData()
  formData.append("attachment", input.file, input.filename)

  const response = await httpFetch(endpoint, {
    method: "POST",
    headers: getAuthHeaders(),
    body: formData,
    label: "clickup.uploadAttachment",
    timeoutMs: CLICKUP_UPLOAD_TIMEOUT_MS,
  })

  const payload = await parseResponse(response)
  if (!response.ok) {
    throw new Error(
      getErrorMessage(payload) || `ClickUp attachment upload failed (${response.status})`
    )
  }
}

export async function fetchClickUpTask(taskId: string) {
  const normalizedTaskId = taskId.trim()
  if (!normalizedTaskId) {
    throw new Error("ClickUp task id is required")
  }

  const endpoint = `${resolveClickUpApiBaseUrl()}/task/${encodeURIComponent(normalizedTaskId)}`
  // Retried: this runs once per ticket inside the sync loop, where one blip
  // would otherwise drop that ticket from the whole run.
  const response = await httpFetch(endpoint, {
    method: "GET",
    headers: getHeaders(),
    label: "clickup.fetchTask",
    timeoutMs: CLICKUP_TIMEOUT_MS,
    attempts: 3,
  })
  const payload = await parseResponse(response)
  if (!response.ok) {
    throw new Error(
      getErrorMessage(payload) || `ClickUp task fetch failed (${response.status})`
    )
  }

  const idFromPayload = getTaskId(payload) ?? normalizedTaskId
  return {
    taskId: idFromPayload,
    taskUrl: getTaskUrl(payload, idFromPayload),
    taskStatus: getTaskStatus(payload),
  } satisfies ClickUpTaskSnapshot
}

export async function fetchClickUpListFields() {
  const listId = resolveClickUpListId()
  const endpoint = `${resolveClickUpApiBaseUrl()}/list/${encodeURIComponent(listId)}/field`
  const response = await httpFetch(endpoint, {
    method: "GET",
    headers: getHeaders(),
    label: "clickup.fetchListFields",
    timeoutMs: CLICKUP_TIMEOUT_MS,
    attempts: 3,
  })

  const payload = await parseResponse(response)
  if (!response.ok) {
    throw new Error(
      getErrorMessage(payload) || `ClickUp custom fields fetch failed (${response.status})`
    )
  }

  const fieldsRaw =
    payload && typeof payload === "object" && Array.isArray((payload as Record<string, unknown>).fields)
      ? ((payload as Record<string, unknown>).fields as unknown[])
      : []

  return fieldsRaw
    .map((item) => {
      if (!item || typeof item !== "object") {
        return null
      }
      const record = item as Record<string, unknown>
      const id = typeof record.id === "string" ? record.id.trim() : ""
      const name = typeof record.name === "string" ? record.name.trim() : ""
      const type = typeof record.type === "string" ? record.type.trim() : ""
      if (!id || !name) {
        return null
      }
      const typeConfig =
        record.type_config && typeof record.type_config === "object"
          ? (record.type_config as Record<string, unknown>)
          : null
      const optionsRaw = Array.isArray(typeConfig?.options)
        ? (typeConfig?.options as unknown[])
        : []
      const options = optionsRaw
        .map((optionItem) => {
          if (!optionItem || typeof optionItem !== "object") {
            return null
          }
          const optionRecord = optionItem as Record<string, unknown>
          const optionId =
            typeof optionRecord.id === "string" ? optionRecord.id.trim() : ""
          const optionName =
            typeof optionRecord.name === "string" ? optionRecord.name.trim() : ""
          if (!optionId || !optionName) {
            return null
          }
          return {
            id: optionId,
            name: optionName,
          } satisfies ClickUpListFieldOption
        })
        .filter((value): value is ClickUpListFieldOption => Boolean(value))
      return {
        id,
        name,
        type,
        options,
      } satisfies ClickUpListField
    })
    .filter((value): value is ClickUpListField => Boolean(value))
}
