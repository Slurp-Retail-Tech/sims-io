import type { RowDataPacket } from "mysql2"

import getPool from "@/lib/db"
import { extractClickUpTaskIdFromLink, fetchClickUpTask } from "@/lib/clickup"
import { formatDateTimeForMysql } from "@/lib/mysql-datetime"

type TicketClickUpRow = RowDataPacket & {
  id: string
  clickup_task_id: string | null
  clickup_link: string | null
  clickup_task_status: string | null
}

export async function resolveActorLabel(userId: string) {
  const pool = getPool()
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT name, email FROM users WHERE id = ? LIMIT 1",
    [userId]
  )
  const actor = rows[0] as { name?: string; email?: string } | undefined
  return actor?.name || actor?.email || userId
}

function normalizeValue(value: string | null | undefined) {
  if (value == null) {
    return null
  }
  const trimmed = value.trim()
  return trimmed || null
}

export async function applyClickUpSnapshotToTicket(input: {
  ticketId: string
  actorLabel: string
  taskId: string | null
  taskUrl: string | null
  taskStatus: string | null
  syncedAt?: Date
}) {
  const pool = getPool()
  const [rows] = await pool.query<TicketClickUpRow[]>(
    `
    SELECT id, clickup_task_id, clickup_link, clickup_task_status
    FROM tickets
    WHERE id = ?
    LIMIT 1
  `,
    [input.ticketId]
  )

  const ticket = rows[0]
  if (!ticket) {
    return { found: false as const, updated: false as const }
  }

  const nextTaskId = normalizeValue(input.taskId)
  const nextTaskUrl = normalizeValue(input.taskUrl)
  const nextTaskStatus = normalizeValue(input.taskStatus)
  const syncedAtMysql = formatDateTimeForMysql(input.syncedAt ?? new Date())

  const changes: Array<{
    column: string
    field: string
    oldValue: string | null
    newValue: string | null
  }> = []

  if (normalizeValue(ticket.clickup_task_id) !== nextTaskId) {
    changes.push({
      column: "clickup_task_id",
      field: "clickup_task_id",
      oldValue: normalizeValue(ticket.clickup_task_id),
      newValue: nextTaskId,
    })
  }
  if (normalizeValue(ticket.clickup_link) !== nextTaskUrl) {
    changes.push({
      column: "clickup_link",
      field: "clickup_link",
      oldValue: normalizeValue(ticket.clickup_link),
      newValue: nextTaskUrl,
    })
  }
  if (normalizeValue(ticket.clickup_task_status) !== nextTaskStatus) {
    changes.push({
      column: "clickup_task_status",
      field: "clickup_task_status",
      oldValue: normalizeValue(ticket.clickup_task_status),
      newValue: nextTaskStatus,
    })
  }

  const setClauses: string[] = []
  const values: Array<string | null> = []

  changes.forEach((change) => {
    setClauses.push(`${change.column} = ?`)
    values.push(change.newValue)
  })
  setClauses.push("clickup_task_status_synced_at = ?")
  values.push(syncedAtMysql)
  setClauses.push("updated_by = ?")
  values.push(input.actorLabel)

  await pool.query(
    `
    UPDATE tickets
    SET ${setClauses.join(", ")}
    WHERE id = ?
  `,
    [...values, input.ticketId]
  )

  for (const change of changes) {
    await pool.query(
      `
      INSERT INTO ticket_history (
        ticket_id,
        field_name,
        old_value,
        new_value,
        changed_by
      )
      VALUES (?, ?, ?, ?, ?)
    `,
      [
        input.ticketId,
        change.field,
        change.oldValue,
        change.newValue,
        input.actorLabel,
      ]
    )
  }

  return {
    found: true as const,
    updated: changes.length > 0,
    changes: changes.map((change) => change.field),
    syncedAt: syncedAtMysql,
  }
}

export async function syncTicketClickUpStatusByTicketId(input: {
  ticketId: string
  actorLabel: string
}) {
  const pool = getPool()
  const [rows] = await pool.query<TicketClickUpRow[]>(
    `
    SELECT id, clickup_task_id, clickup_link, clickup_task_status
    FROM tickets
    WHERE id = ?
    LIMIT 1
  `,
    [input.ticketId]
  )
  const ticket = rows[0]
  if (!ticket) {
    return { ok: false as const, reason: "not_found" as const }
  }

  const taskId =
    normalizeValue(ticket.clickup_task_id) ??
    extractClickUpTaskIdFromLink(ticket.clickup_link)
  if (!taskId) {
    return { ok: false as const, reason: "missing_task_id" as const }
  }

  const snapshot = await fetchClickUpTask(taskId)
  await applyClickUpSnapshotToTicket({
    ticketId: ticket.id,
    actorLabel: input.actorLabel,
    taskId: snapshot.taskId,
    taskUrl: snapshot.taskUrl,
    taskStatus: snapshot.taskStatus,
    syncedAt: new Date(),
  })

  return {
    ok: true as const,
    task: snapshot,
  }
}

export async function syncAllClickUpTicketStatuses(input: { actorLabel: string }) {
  const pool = getPool()
  const [rows] = await pool.query<TicketClickUpRow[]>(
    `
    SELECT id, clickup_task_id, clickup_link, clickup_task_status
    FROM tickets
    WHERE (clickup_task_id IS NOT NULL AND clickup_task_id <> '')
       OR (clickup_link IS NOT NULL AND clickup_link <> '')
    ORDER BY id ASC
  `
  )

  let synced = 0
  let failed = 0
  let skipped = 0
  const errors: Array<{ ticketId: string; error: string }> = []

  for (const row of rows) {
    try {
      const taskId =
        normalizeValue(row.clickup_task_id) ??
        extractClickUpTaskIdFromLink(row.clickup_link)
      if (!taskId) {
        skipped += 1
        continue
      }
      const snapshot = await fetchClickUpTask(taskId)
      await applyClickUpSnapshotToTicket({
        ticketId: row.id,
        actorLabel: input.actorLabel,
        taskId: snapshot.taskId,
        taskUrl: snapshot.taskUrl,
        taskStatus: snapshot.taskStatus,
        syncedAt: new Date(),
      })
      synced += 1
    } catch (error) {
      failed += 1
      errors.push({
        ticketId: row.id,
        error: error instanceof Error ? error.message : "Unknown error",
      })
    }
  }

  return {
    total: rows.length,
    synced,
    failed,
    skipped,
    errors: errors.slice(0, 25),
  }
}
