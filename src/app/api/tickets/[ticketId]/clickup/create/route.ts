import { NextRequest, NextResponse } from "next/server"
import type { RowDataPacket } from "mysql2"

import { createClickUpTask } from "@/lib/clickup"
import { applyClickUpSnapshotToTicket, resolveActorLabel } from "@/lib/clickup-ticket-sync"
import getPool from "@/lib/db"
import { requireAuthenticatedUser } from "@/lib/auth"

type TicketForTaskRow = RowDataPacket & {
  id: string
  merchant_name: string | null
  franchise_name_resolved: string | null
  outlet_name_resolved: string | null
  phone_number: string | null
  fid: string | null
  oid: string | null
  issue_type: string | null
  issue_subcategory1: string | null
  issue_subcategory2: string | null
  issue_description: string | null
  ticket_description: string | null
  clickup_task_id: string | null
}

function buildClickUpName(ticket: TicketForTaskRow) {
  const issue = ticket.issue_type?.trim() || "Support issue"
  const outlet = ticket.outlet_name_resolved?.trim() || ticket.merchant_name?.trim() || "Unknown outlet"
  return `Ticket #${ticket.id} · ${issue} · ${outlet}`
}

function buildClickUpDescription(ticket: TicketForTaskRow) {
  const lines = [
    `Ticket ID: ${ticket.id}`,
    `Merchant: ${ticket.merchant_name ?? "-"}`,
    `Franchise: ${ticket.franchise_name_resolved ?? "-"}`,
    `Outlet: ${ticket.outlet_name_resolved ?? "-"}`,
    `Customer phone: ${ticket.phone_number ?? "-"}`,
    `FID/OID: ${ticket.fid ?? "-"} / ${ticket.oid ?? "-"}`,
    `Category: ${ticket.issue_type ?? "-"}`,
    `Subcategory 1: ${ticket.issue_subcategory1 ?? "-"}`,
    `Subcategory 2: ${ticket.issue_subcategory2 ?? "-"}`,
    "",
    "Issue Description:",
    ticket.issue_description?.trim() || "-",
  ]

  const internalNotes = ticket.ticket_description?.trim()
  if (internalNotes) {
    lines.push("", "Internal Notes:", internalNotes)
  }

  return lines.join("\n")
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ ticketId: string }> }
) {
  const user = await requireAuthenticatedUser(request)
  if (!user) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 })
  }
  const userId = user.id

  const actorLabel = await resolveActorLabel(userId)
  const { ticketId } = await params
  const pool = getPool()
  const [rows] = await pool.query<TicketForTaskRow[]>(
    `
    SELECT
      id,
      merchant_name,
      franchise_name_resolved,
      outlet_name_resolved,
      phone_number,
      fid,
      oid,
      issue_type,
      issue_subcategory1,
      issue_subcategory2,
      issue_description,
      ticket_description,
      clickup_task_id
    FROM tickets
    WHERE id = ?
    LIMIT 1
  `,
    [ticketId]
  )
  const ticket = rows[0]
  if (!ticket) {
    return NextResponse.json({ error: "Ticket not found." }, { status: 404 })
  }

  if (ticket.clickup_task_id?.trim()) {
    return NextResponse.json(
      { error: "Ticket already has a linked ClickUp task." },
      { status: 409 }
    )
  }

  try {
    const snapshot = await createClickUpTask({
      name: buildClickUpName(ticket),
      description: buildClickUpDescription(ticket),
    })
    await applyClickUpSnapshotToTicket({
      ticketId,
      actorLabel,
      taskId: snapshot.taskId,
      taskUrl: snapshot.taskUrl,
      taskStatus: snapshot.taskStatus,
      syncedAt: new Date(),
    })

    return NextResponse.json({ task: snapshot })
  } catch (error) {
    console.error(error)
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to create ClickUp task.",
      },
      { status: 500 }
    )
  }
}
