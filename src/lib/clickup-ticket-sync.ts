import type { RowDataPacket } from "mysql2"

import getPool, { withTransaction } from "@/lib/db"
import { insertTicketHistory } from "@/lib/ticket-history"
import { extractClickUpTaskIdFromLink, fetchClickUpTask } from "@/lib/clickup"
import { formatDateTimeForMysql } from "@/lib/mysql-datetime"
import { resolveTicketHistoryActor } from "@/lib/ticket-history-actor"

type TicketClickUpRow = RowDataPacket & {
  id: string
  clickup_task_id: string | null
  clickup_link: string | null
  clickup_task_status: string | null
}

export function resolveActorLabel(userId: string) {
  return resolveTicketHistoryActor({ id: userId })
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
  // One transaction per ticket: the snapshot write and its history rows are a
  // unit, and the read must be locked or every old_value below can describe a
  // state that was already replaced. The ClickUp fetch that produced this
  // snapshot runs in the caller, deliberately outside this transaction — a
  // network call must never be held open across a row lock.
  return withTransaction(async (connection) => {
    const [rows] = await connection.query<TicketClickUpRow[]>(
      `
      SELECT id, clickup_task_id, clickup_link, clickup_task_status
      FROM tickets
      WHERE id = ?
      LIMIT 1
      FOR UPDATE
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

    await connection.query(
      `
      UPDATE tickets
      SET ${setClauses.join(", ")}
      WHERE id = ?
    `,
      [...values, input.ticketId]
    )

    await insertTicketHistory(
      connection,
      input.ticketId,
      changes.map((change) => ({
        field: change.field,
        oldValue: change.oldValue,
        newValue: change.newValue,
      })),
      input.actorLabel
    )

    return {
      found: true as const,
      updated: changes.length > 0,
      changes: changes.map((change) => change.field),
      syncedAt: syncedAtMysql,
    }
  })
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

export type ClickUpSyncBatchResult = {
  processed: number
  synced: number
  failed: number
  skipped: number
  lastTicketId: string | null
  done: boolean
  errors: Array<{ ticketId: string; error: string }>
}

/** How many tickets one slice pulls per SELECT. */
export const CLICKUP_SYNC_SLICE_SIZE = (() => {
  const raw = Number(process.env.CLICKUP_SYNC_SLICE_SIZE ?? 100)
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 100
})()

/**
 * Sync one bounded batch of tickets, resuming after `afterTicketId`.
 *
 * Replaces an unbounded SELECT of every linked ticket followed by a serial loop
 * of un-timed ClickUp calls in a single HTTP request. Keyset pagination on
 * `id > ?` rather than OFFSET: it is index-only, and it stays correct when rows
 * are inserted between slices.
 */
export async function syncClickUpTicketBatch(input: {
  actorLabel: string
  afterTicketId: string | null
  limit?: number
  /** Stop starting new tickets once this passes; the batch returns early. */
  deadlineAt?: number
}): Promise<ClickUpSyncBatchResult> {
  const limit = input.limit ?? CLICKUP_SYNC_SLICE_SIZE
  const pool = getPool()

  const [rows] = await pool.query<TicketClickUpRow[]>(
    `
    SELECT id, clickup_task_id, clickup_link, clickup_task_status
    FROM tickets
    WHERE ((clickup_task_id IS NOT NULL AND clickup_task_id <> '')
        OR (clickup_link IS NOT NULL AND clickup_link <> ''))
      AND (? IS NULL OR id > ?)
    ORDER BY id ASC
    LIMIT ?
  `,
    [input.afterTicketId, input.afterTicketId, limit]
  )

  let synced = 0
  let failed = 0
  let skipped = 0
  let processed = 0
  let lastTicketId: string | null = null
  const errors: Array<{ ticketId: string; error: string }> = []

  for (const row of rows) {
    // Checked before each ticket, not after: a ticket started with no budget
    // left would blow the slice deadline on its network call alone.
    if (input.deadlineAt !== undefined && Date.now() >= input.deadlineAt) {
      break
    }

    processed += 1
    lastTicketId = row.id

    try {
      const taskId =
        normalizeValue(row.clickup_task_id) ??
        extractClickUpTaskIdFromLink(row.clickup_link)
      if (!taskId) {
        skipped += 1
        continue
      }
      // Network call outside the per-ticket transaction inside
      // applyClickUpSnapshotToTicket, deliberately.
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
      // Per-ticket failures are recorded, not thrown: one unreachable ClickUp
      // task must not abandon the rest of the run.
      failed += 1
      errors.push({
        ticketId: row.id,
        error: error instanceof Error ? error.message : "Unknown error",
      })
    }
  }

  return {
    processed,
    synced,
    failed,
    skipped,
    lastTicketId,
    // Only a genuinely short page is terminal. Stopping early on the deadline
    // means there is more to do, not that we reached the end.
    done: processed === rows.length && rows.length < limit,
    errors,
  }
}
