import { NextRequest, NextResponse } from "next/server"
import type { RowDataPacket } from "mysql2"

import { requireAuthenticatedUser } from "@/lib/auth"
import { issueCsatLink } from "@/lib/csat-link"
import { withTransaction } from "@/lib/db"
import { insertTicketHistory } from "@/lib/ticket-history"
import { resolveTicketHistoryActor } from "@/lib/ticket-history-actor"

type TicketRow = RowDataPacket & {
  id: string
  status: string
}

/**
 * POST /api/tickets/:ticketId/csat/share — mint (or reuse) the survey token for a
 * manual share and record that the link went out.
 *
 * The token work itself lives in `src/lib/csat-link.ts`, shared with the automatic
 * send that fires when a ticket is closed, so both paths issue identical links. This
 * route only adds the authorization check, the Resolved-only guard, and the history
 * entries.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ ticketId: string }> }
) {
  const user = await requireAuthenticatedUser(request)
  if (!user) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 })
  }

  const { ticketId } = await params
  const actorId = resolveTicketHistoryActor(user)

  // The status guard, the token mint and both history rows are one unit.
  // issueCsatLink supersedes any live token before inserting its replacement,
  // so a failure between those two writes would leave the ticket with no usable
  // link. The status is read FOR UPDATE so a concurrent reopen cannot slip a
  // share past the Resolved-only guard.
  const outcome = await withTransaction(async (connection) => {
    const [ticketRows] = await connection.query<TicketRow[]>(
      "SELECT id, status FROM tickets WHERE id = ? LIMIT 1 FOR UPDATE",
      [ticketId]
    )
    const ticket = ticketRows[0]
    if (!ticket) {
      return { error: "Ticket not found.", status: 404 } as const
    }
    if (ticket.status !== "Resolved") {
      return {
        error: "CSAT link can only be shared for resolved tickets.",
        status: 400,
      } as const
    }

    const link = await issueCsatLink(connection, ticketId)
    if (!link) {
      return { error: "Unable to create CSAT link.", status: 500 } as const
    }

    await insertTicketHistory(
      connection,
      ticketId,
      [
        ...(link.generated
          ? [
              {
                field: "csat_token_generated",
                oldValue: null,
                newValue: "[generated]",
              },
            ]
          : []),
        {
          field: "csat_link_shared",
          oldValue: null,
          newValue: null,
          newValueIsNow: true,
        },
      ],
      actorId
    )

    return { link } as const
  })

  if ("error" in outcome) {
    return NextResponse.json(
      { error: outcome.error },
      { status: outcome.status }
    )
  }

  return NextResponse.json({
    ok: true,
    token: outcome.link.token,
    expiresAt: outcome.link.expiresAt,
    generated: outcome.link.generated,
  })
}
