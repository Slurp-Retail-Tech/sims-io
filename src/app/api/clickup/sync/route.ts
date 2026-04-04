import { NextRequest, NextResponse } from "next/server"

import { requireAuthenticatedUser } from "@/lib/auth"
import { resolveActorLabel, syncAllClickUpTicketStatuses } from "@/lib/clickup-ticket-sync"

function isCronAuthorized(request: NextRequest) {
  const cronSecret = process.env.CLICKUP_SYNC_CRON_SECRET?.trim()
  const providedSecret = request.headers.get("x-cron-secret")?.trim()
  return Boolean(cronSecret && providedSecret && providedSecret === cronSecret)
}

export async function POST(request: NextRequest) {
  const cronAllowed = isCronAuthorized(request)

  if (!cronAllowed) {
    const user = await requireAuthenticatedUser(request)
    if (!user) {
      return NextResponse.json({ error: "Unauthorized." }, { status: 401 })
    }
    const actorLabel = await resolveActorLabel(user.id)
    try {
      const result = await syncAllClickUpTicketStatuses({ actorLabel })
      return NextResponse.json({ result })
    } catch (error) {
      console.error(error)
      return NextResponse.json(
        {
          error:
            error instanceof Error
              ? error.message
              : "Failed to run ClickUp status sync.",
        },
        { status: 500 }
      )
    }
  }

  const actorLabel = "ClickUp Cron Sync"
  try {
    const result = await syncAllClickUpTicketStatuses({ actorLabel })
    return NextResponse.json({ result })
  } catch (error) {
    console.error(error)
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to run ClickUp status sync.",
      },
      { status: 500 }
    )
  }
}
