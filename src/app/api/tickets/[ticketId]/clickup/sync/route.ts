import { NextRequest, NextResponse } from "next/server"

import { requireAuthenticatedUser } from "@/lib/auth"
import { resolveActorLabel, syncTicketClickUpStatusByTicketId } from "@/lib/clickup-ticket-sync"

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ ticketId: string }> }
) {
  const user = await requireAuthenticatedUser(request)
  if (!user) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 })
  }

  const { ticketId } = await params
  const actorLabel = await resolveActorLabel(user.id)

  try {
    const result = await syncTicketClickUpStatusByTicketId({
      ticketId,
      actorLabel,
    })

    if (!result.ok) {
      if (result.reason === "not_found") {
        return NextResponse.json({ error: "Ticket not found." }, { status: 404 })
      }
      if (result.reason === "missing_task_id") {
        return NextResponse.json(
          { error: "Ticket has no ClickUp task id to sync." },
          { status: 400 }
        )
      }
    }

    return NextResponse.json({ task: result.task })
  } catch (error) {
    console.error(error)
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to sync ClickUp status.",
      },
      { status: 500 }
    )
  }
}
