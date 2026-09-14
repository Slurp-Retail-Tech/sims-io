import { NextRequest, NextResponse } from "next/server"
import type { RowDataPacket } from "mysql2"

import { resolveApiUser } from "@/lib/api-auth"
import { sendCsatLinkForClosedTicket } from "@/lib/csat-link"
import {
  getCsatTokenColumn,
  getCsatTokenSelectExpressions,
} from "@/lib/csat-schema"
import getPool, { withTransaction } from "@/lib/db"
import { insertTicketHistory } from "@/lib/ticket-history"
import { normalizeDateTimeForMysqlInput } from "@/lib/mysql-datetime"
import { resolveStoredObjectUrl } from "@/lib/storage"
import { resolveMerchantNames } from "@/lib/merchant-outlet-resolution"
import { persistManualOutletMapping } from "@/lib/respondio"
import type { CsatDispatchResult } from "@/lib/respondio-csat"
import { resolveTicketHistoryActor } from "@/lib/ticket-history-actor"
import { parseJsonBody } from "@/lib/validation"
import { ticketPatchSchema } from "./schema"

type TicketDetailRow = RowDataPacket & {
  id: string
  merchant_name: string | null
  phone_number: string | null
  franchise_name_resolved: string | null
  outlet_name_resolved: string | null
  fid: string | null
  oid: string | null
  status: string
  source: string | null
  respondio_contact_id: string | null
  contact_id: string | null
  needs_outlet_match: number
  hidden: number
  issue_type: string | null
  issue_subcategory1: string | null
  issue_subcategory2: string | null
  issue_description: string | null
  ticket_description: string | null
  clickup_link: string | null
  clickup_task_id: string | null
  clickup_task_status: string | null
  clickup_task_status_synced_at: string | null
  attachment_url: string | null
  attachment_url_2: string | null
  attachment_url_3: string | null
  attended_at: string | null
  merchant_sentiment: string | null
  created_at: string
  updated_at: string
  closed_at: string | null
  updated_by: string | null
  updated_by_display: string | null
  ms_pic_user_id: string | null
  ms_pic_name: string | null
}

type CsatTokenRow = RowDataPacket & {
  token: string | null
  token_hash: string
  created_at: string
  expires_at: string
  used_at: string | null
}

type CsatResponseRow = RowDataPacket & {
  support_score: string | null
  support_reason: string | null
  product_score: string | null
  product_feedback: string | null
  submitted_at: string
}

type CsatSendHistoryRow = RowDataPacket & {
  ticket_id: string
}


function toSurveyStatus(
  token: CsatTokenRow | null,
  response: CsatResponseRow | null,
  wasWhatsappSent: boolean
) {
  if (!token) {
    return "Not Sent"
  }
  if (response) {
    return "Responded"
  }
  if (token.used_at) {
    return "Used"
  }
  const expires = new Date(token.expires_at)
  if (!Number.isNaN(expires.valueOf()) && expires.getTime() < Date.now()) {
    return "Expired"
  }
  if (wasWhatsappSent) {
    return "Send"
  }
  return "Generated"
}

function isClosedStatus(value: string | null | undefined) {
  const normalized = (value ?? "").trim().toLowerCase()
  return normalized === "resolved" || normalized === "closed"
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ ticketId: string }> }
) {
  const auth = await resolveApiUser(request, {})
  if ("response" in auth) {
    return auth.response
  }

  const { ticketId } = await params
  const pool = getPool()

  const [ticketRows] = await pool.query<TicketDetailRow[]>(
    `
    SELECT
      tickets.id,
      tickets.merchant_name,
      tickets.phone_number,
      tickets.franchise_name_resolved,
      tickets.outlet_name_resolved,
      tickets.fid,
      tickets.oid,
      tickets.status,
      tickets.source,
      tickets.respondio_contact_id,
      tickets.contact_id,
      tickets.needs_outlet_match,
      tickets.hidden,
      tickets.issue_type,
      tickets.issue_subcategory1,
      tickets.issue_subcategory2,
      tickets.issue_description,
      tickets.ticket_description,
      tickets.clickup_link,
      tickets.clickup_task_id,
      tickets.clickup_task_status,
      tickets.clickup_task_status_synced_at,
      tickets.attachment_url,
      tickets.attachment_url_2,
      tickets.attachment_url_3,
      tickets.attended_at,
      tickets.merchant_sentiment,
      tickets.created_at,
      tickets.updated_at,
      tickets.closed_at,
      tickets.updated_by,
      updater.name AS updated_by_display,
      tickets.ms_pic_user_id,
      users.name AS ms_pic_name
    FROM tickets
    LEFT JOIN users
      ON users.id = tickets.ms_pic_user_id
    LEFT JOIN users AS updater
      ON updater.id = tickets.updated_by
    WHERE tickets.id = ?
    LIMIT 1
  `,
    [ticketId]
  )

  const row = ticketRows[0]
  if (!row) {
    return NextResponse.json({ error: "Ticket not found." }, { status: 404 })
  }

  // `ticket_id` directly on both tables: the legacy `request_id` spelling is
  // gone from every deployed shape (confirmed against production 2026-08-29).
  // The token column still needs probing until migration 030 drops the
  // plaintext one.
  const csatTokenTicketColumn = "ticket_id"
  const csatResponseTicketColumn = "ticket_id"
  const csatTokenColumn = await getCsatTokenColumn(pool)
  const csatTokenSelectExpressions = getCsatTokenSelectExpressions(csatTokenColumn)

  const [tokenRows] = await pool.query<CsatTokenRow[]>(
    `
    SELECT ${csatTokenSelectExpressions}, created_at, expires_at, used_at
    FROM csat_tokens
    WHERE ${csatTokenTicketColumn} = ?
    ORDER BY id DESC
    LIMIT 1
  `,
    [ticketId]
  )
  const token = tokenRows[0] ?? null

  const [responseRows] = await pool.query<CsatResponseRow[]>(
    `
    SELECT support_score, support_reason, product_score, product_feedback, submitted_at
    FROM csat_responses
    WHERE ${csatResponseTicketColumn} = ?
    ORDER BY id DESC
    LIMIT 1
  `,
    [ticketId]
  )
  const response = responseRows[0] ?? null

  const [sendRows] = await pool.query<CsatSendHistoryRow[]>(
    `
    SELECT ticket_id
    FROM ticket_history
    WHERE ticket_id = ?
      AND field_name IN ('csat_link_shared', 'csat_link_shared_at')
    LIMIT 1
  `,
    [ticketId]
  )
  const wasWhatsappSent = sendRows.length > 0

  const attachments = [
    row.attachment_url,
    row.attachment_url_2,
    row.attachment_url_3,
  ]
    .map((value) => resolveStoredObjectUrl(value))
    .filter(Boolean) as string[]

  return NextResponse.json({
    ticket: {
      id: row.id,
      merchantName: row.merchant_name,
      customerPhone: row.phone_number,
      franchiseName: row.franchise_name_resolved,
      outletName: row.outlet_name_resolved,
      fid: row.fid,
      oid: row.oid,
      status: row.status,
      source: row.source,
      respondioContactId: row.respondio_contact_id,
      contactId: row.contact_id,
      needsOutletMatch: Boolean(row.needs_outlet_match),
      hidden: Boolean(row.hidden),
      category: row.issue_type,
      subcategory1: row.issue_subcategory1,
      subcategory2: row.issue_subcategory2,
      issueDescription: row.issue_description,
      ticketDescription: row.ticket_description,
      clickupLink: row.clickup_link,
      clickupTaskId: row.clickup_task_id,
      clickupTaskStatus: row.clickup_task_status,
      clickupTaskStatusSyncedAt: row.clickup_task_status_synced_at,
      attachments,
      attendedAt: row.attended_at,
      merchantSentiment: row.merchant_sentiment,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      closedAt: row.closed_at,
      updatedBy: row.updated_by_display ?? row.updated_by,
      msPicUserId: row.ms_pic_user_id,
      msPicName: row.ms_pic_name,
      csat: {
        surveyStatus: toSurveyStatus(token, response, wasWhatsappSent),
        token: token?.token ?? null,
        tokenHash: token?.token_hash ?? null,
        tokenPreview: token?.token_hash
          ? `${token.token_hash.slice(0, 8)}...${token.token_hash.slice(-4)}`
          : null,
        createdAt: token?.created_at ?? null,
        expiresAt: token?.expires_at ?? null,
        usedAt: token?.used_at ?? null,
        response: response
          ? {
              supportScore: response.support_score,
              supportComment: response.support_reason,
              productScore: response.product_score,
              productFeedback: response.product_feedback,
              submittedAt: response.submitted_at,
            }
          : null,
      },
    },
  })
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ ticketId: string }> }
) {
  const auth = await resolveApiUser(request, { allowedPaths: ["/tickets"] })
  if ("response" in auth) {
    return auth.response
  }
  const user = auth.user

  const { ticketId } = await params
  const parsedBody = await parseJsonBody(request, ticketPatchSchema)
  if (!parsedBody.ok) {
    return parsedBody.response
  }
  const body = parsedBody.data

  // One transaction from the current-state read to the mapping write. The read
  // is FOR UPDATE because the diff below computes every old_value from it:
  // unlocked, two concurrent PATCHes each diff against a stale snapshot and both
  // record history describing a state the other already replaced. The CSAT
  // dispatch is deliberately left outside — it makes a network call.
  const outcome = await withTransaction(async (connection) => {
    const [rows] = await connection.query<TicketDetailRow[]>(
      `
      SELECT
        id,
        status,
        hidden,
        merchant_name,
        phone_number,
        fid,
        oid,
        source,
        respondio_contact_id,
        contact_id,
        needs_outlet_match,
        franchise_name_resolved,
        outlet_name_resolved,
        issue_type,
        issue_subcategory1,
        issue_subcategory2,
        issue_description,
        ticket_description,
        ms_pic_user_id,
        clickup_task_id,
        clickup_link,
        clickup_task_status,
        clickup_task_status_synced_at,
        attended_at,
        merchant_sentiment
      FROM tickets
      WHERE id = ?
      LIMIT 1
      FOR UPDATE
    `,
      [ticketId]
    )
    const current = rows[0]
    if (!current) {
      return { notFound: true } as const
    }

    const updates: Array<{ column: string; value: string | null | number }> = []
    const history: Array<{ field: string; oldValue: string | null; newValue: string | null }> = []

    const compareAndPush = (
      field: string,
      column: string,
      oldValue: string | number | null,
      newValue: string | number | null
    ) => {
      const oldNormalized = oldValue == null ? null : String(oldValue)
      const newNormalized = newValue == null ? null : String(newValue)
      if (oldNormalized === newNormalized) {
        return
      }
      updates.push({ column, value: newNormalized })
      history.push({
        field,
        oldValue: oldNormalized,
        newValue: newNormalized,
      })
    }

    if (typeof body.status === "string") {
      compareAndPush("status", "status", current.status, body.status)
    }
    if (typeof body.hidden === "boolean") {
      compareAndPush(
        "hidden",
        "hidden",
        current.hidden ? "1" : "0",
        body.hidden ? "1" : "0"
      )
    }
    if (typeof body.merchantName === "string") {
      compareAndPush(
        "merchant_name",
        "merchant_name",
        current.merchant_name,
        body.merchantName
      )
    }
    if (typeof body.customerPhone === "string") {
      compareAndPush(
        "phone_number",
        "phone_number",
        current.phone_number,
        body.customerPhone
      )
    }

    // `tickets.fid` / `tickets.oid` are nullable since migration 025, so a cleared
    // field must be written as NULL rather than the empty string an earlier version of
    // this route stored. A mixed ''/NULL column is what forced the
    // `NULLIF(TRIM(fid), '')` guards in the analytics queries; don't add more of them.
    const submittedFid =
      typeof body.fid === "string" ? body.fid.trim() || null : undefined
    const submittedOid =
      typeof body.oid === "string" ? body.oid.trim() || null : undefined

    const nextFid = submittedFid !== undefined ? submittedFid : current.fid
    const nextOid = submittedOid !== undefined ? submittedOid : current.oid

    if (submittedFid !== undefined) {
      compareAndPush("fid", "fid", current.fid, submittedFid)
    }
    if (submittedOid !== undefined) {
      compareAndPush("oid", "oid", current.oid, submittedOid)
    }

    // Resolve on the franchise alone, not both ids. A Respond.io ticket pre-filled from
    // a franchise-wide contact mapping has `fid` set and `oid` deliberately unset, and
    // it still has to show a franchise name.
    if ((submittedFid !== undefined || submittedOid !== undefined) && nextFid) {
      const resolved = await resolveMerchantNames(connection, nextFid, nextOid)
      compareAndPush(
        "franchise_name_resolved",
        "franchise_name_resolved",
        current.franchise_name_resolved,
        resolved.franchiseName
      )
      compareAndPush(
        "outlet_name_resolved",
        "outlet_name_resolved",
        current.outlet_name_resolved,
        resolved.outletName
      )
    }

    // Once both ids are present the ticket is linked, so the manual-match flag clears
    // itself. This is what the ticket detail page's "Link outlet" action relies on.
    if (submittedFid !== undefined || submittedOid !== undefined) {
      const stillNeedsMatch = !(nextFid && nextOid)
      compareAndPush(
        "needs_outlet_match",
        "needs_outlet_match",
        current.needs_outlet_match ? "1" : "0",
        stillNeedsMatch ? "1" : "0"
      )
    }
    if (typeof body.category === "string") {
      compareAndPush("issue_type", "issue_type", current.issue_type, body.category)
    }
    if (typeof body.subcategory1 === "string") {
      compareAndPush(
        "issue_subcategory1",
        "issue_subcategory1",
        current.issue_subcategory1,
        body.subcategory1
      )
    }
    if (body.subcategory2 !== undefined) {
      compareAndPush(
        "issue_subcategory2",
        "issue_subcategory2",
        current.issue_subcategory2,
        body.subcategory2 ?? null
      )
    }
    if (typeof body.issueDescription === "string") {
      compareAndPush(
        "issue_description",
        "issue_description",
        current.issue_description,
        body.issueDescription
      )
    }
    if (body.ticketDescription !== undefined) {
      compareAndPush(
        "ticket_description",
        "ticket_description",
        current.ticket_description,
        body.ticketDescription ?? null
      )
    }
    if (body.msPicUserId !== undefined) {
      compareAndPush(
        "ms_pic_user_id",
        "ms_pic_user_id",
        current.ms_pic_user_id,
        body.msPicUserId ?? null
      )
    }
    if (body.clickupTaskId !== undefined) {
      compareAndPush(
        "clickup_task_id",
        "clickup_task_id",
        current.clickup_task_id,
        body.clickupTaskId ?? null
      )
    }
    if (body.clickupLink !== undefined) {
      compareAndPush(
        "clickup_link",
        "clickup_link",
        current.clickup_link,
        body.clickupLink ?? null
      )
    }
    if (body.clickupTaskStatus !== undefined) {
      compareAndPush(
        "clickup_task_status",
        "clickup_task_status",
        current.clickup_task_status,
        body.clickupTaskStatus ?? null
      )
    }
    if (body.clickupTaskStatusSyncedAt !== undefined) {
      const normalizedSyncedAt = normalizeDateTimeForMysqlInput(
        body.clickupTaskStatusSyncedAt
      )
      compareAndPush(
        "clickup_task_status_synced_at",
        "clickup_task_status_synced_at",
        current.clickup_task_status_synced_at,
        normalizedSyncedAt
      )
    }
    if (body.merchantSentiment !== undefined) {
      compareAndPush(
        "merchant_sentiment",
        "merchant_sentiment",
        current.merchant_sentiment,
        body.merchantSentiment ?? null
      )
    }

    if (body.attend === true && !current.attended_at) {
      const [nowRows] = await connection.query<RowDataPacket[]>(
        "SELECT CAST(UTC_TIMESTAMP(3) AS CHAR) AS now_value"
      )
      const attendedAtValue = String(nowRows[0]?.now_value ?? "").slice(0, 23)
      if (attendedAtValue) {
        compareAndPush(
          "attended_at",
          "attended_at",
          current.attended_at,
          attendedAtValue
        )
      }
    }

    if (!updates.length) {
      return { updated: false } as const
    }

    const actorId = resolveTicketHistoryActor(user)
    const setClauses: string[] = []
    const paramsList: Array<string | null | number> = []

    updates.forEach((item) => {
      setClauses.push(`${item.column} = ?`)
      paramsList.push(item.value)
    })

    const nextStatus = body.status ?? current.status
    setClauses.push("updated_by = ?")
    paramsList.push(actorId)

    const transitionedToClosed = isClosedStatus(nextStatus) && !isClosedStatus(current.status)

    if (transitionedToClosed) {
      setClauses.push("closed_at = NOW(3)")
    } else if (!isClosedStatus(nextStatus) && isClosedStatus(current.status)) {
      setClauses.push("closed_at = NULL")
    }

    await connection.query(
      `
      UPDATE tickets
      SET ${setClauses.join(", ")}
      WHERE id = ?
    `,
      [...paramsList, ticketId]
    )

    await insertTicketHistory(
      connection,
      ticketId,
      history.map((item) => ({
        field: item.field,
        oldValue: item.oldValue,
        newValue: item.newValue,
      })),
      actorId
    )

    // Manual outlet linking (Respond.io PRD 4.5): confirming an outlet on a flagged
    // ticket teaches the contact directory, so the next ticket from the same contact
    // auto-links. Nothing is written when the contact already holds a franchise-wide
    // mapping covering that franchise — the row would be redundant and the Contacts
    // overlap rule forbids it (AC13).
    // Manual outlet linking now shares the ticket update's transaction. Its
    // failure is therefore fatal, where it used to be swallowed with a
    // console.error: with the whole PATCH atomic and safe to retry, a mapping the
    // agent explicitly confirmed silently not persisting is the worse outcome.
    let mappingWritten = false
    if (
      current.contact_id &&
      nextFid &&
      nextOid &&
      (submittedFid !== undefined || submittedOid !== undefined)
    ) {
      const result = await persistManualOutletMapping(connection, {
        contactId: String(current.contact_id),
        franchiseId: nextFid,
        outletId: nextOid,
        userId: actorId,
      })
      mappingWritten = result.inserted
    }

    return {
      updated: true,
      mappingWritten,
      transitionedToClosed,
      actorId,
      // Carried out of the transaction for the CSAT dispatch below, which runs
      // outside it.
      respondioContactId: current.respondio_contact_id,
      phone: body.customerPhone ?? current.phone_number,
      merchantName: body.merchantName ?? current.merchant_name,
    } as const
  })

  if ("notFound" in outcome) {
    return NextResponse.json({ error: "Ticket not found." }, { status: 404 })
  }
  if (!outcome.updated) {
    return NextResponse.json({ ok: true, updated: false })
  }
  const { mappingWritten, transitionedToClosed } = outcome

  // CSAT on close (Respond.io outbound): closing a Respond.io-sourced ticket pushes the
  // survey link into the same WhatsApp conversation the merchant already used, so the
  // agent no longer has to remember the share button. Skipped for tickets with no
  // Respond.io contact, for tickets whose link was already shared manually, and in
  // environments with no webhook configured.
  //
  // Deliberately after the commit and non-fatal: the close is what the agent asked for
  // and has already succeeded. Failing the request over a messaging hiccup would report
  // a close that did not happen, and invite a retry that re-sends nothing. The outcome
  // comes back in the response so the UI can say the survey did not go out.
  let csatAutoSend: CsatDispatchResult | null = null
  if (transitionedToClosed) {
    try {
      csatAutoSend = await sendCsatLinkForClosedTicket({
        ticketId: String(ticketId),
        respondioContactId: outcome.respondioContactId,
        phone: outcome.phone,
        merchantName: outcome.merchantName,
        actorId: outcome.actorId,
      })
    } catch (error) {
      console.error("Failed to send CSAT link on ticket close", error)
      csatAutoSend = { status: "failed", error: "Unexpected dispatch failure." }
    }
  }

  return NextResponse.json({
    ok: true,
    updated: true,
    contactMappingWritten: mappingWritten,
    csatAutoSend,
  })
}
