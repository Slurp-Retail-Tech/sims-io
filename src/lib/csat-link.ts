/**
 * Issue, format and deliver the CSAT survey link for a ticket.
 *
 * Extracted from `src/app/api/tickets/[ticketId]/csat/share/route.ts` so the manual
 * share button and the automatic send on ticket close mint tokens the same way. The
 * two callers differ only in how they deliver the link and what they record
 * afterwards, never in the token's shape or lifetime.
 *
 * `sendCsatLinkForClosedTicket` at the bottom is the automatic path: it is the only
 * database-touching part of the Respond.io CSAT send, and delegates every decision to
 * the import-free `respondio-csat.ts`.
 *
 * Token storage is schema-tolerant: `csat-schema.ts` resolves whether the live
 * database holds `token_hash` or the legacy plaintext `token` column, and whether the
 * FK is `ticket_id` or the legacy `request_id`.
 */

import { randomUUID } from "node:crypto"
import type { ResultSetHeader, RowDataPacket } from "mysql2"

import { hashOpaqueToken, resolveAppBaseUrl } from "@/lib/auth"
import {
  getCsatTokenColumn,
  getCsatTokenSelectExpressions,
  getCsatTokenStorageValue,
} from "@/lib/csat-schema"
import { withTransaction } from "@/lib/db"
import type { Queryable } from "@/lib/db"
import { insertTicketHistory } from "@/lib/ticket-history"
import {
  CSAT_SEND_FAILED_HISTORY_FIELD,
  CSAT_SHARED_HISTORY_FIELD,
  dispatchCsatLink,
  isCsatAutoSendConfigured,
  resolveCsatAutoSendDecision,
} from "@/lib/respondio-csat"
import type { CsatDispatchResult } from "@/lib/respondio-csat"

/** Days a freshly minted survey token stays valid. Matches the manual share flow. */
const TOKEN_TTL_DAYS = 3


type CsatTokenRow = RowDataPacket & {
  id: string
  token: string | null
  token_hash: string
  expires_at: string
  used_at: string | null
}

type InsertedTokenRow = RowDataPacket & {
  expires_at: string
}

export type IssuedCsatLink = {
  token: string
  expiresAt: string
  /** True when a new token was minted, false when an unused live token was reused. */
  generated: boolean
}

/**
 * Return the ticket's usable survey token, minting a new one when needed.
 *
 * A token is reused only while it is still readable (plaintext column), unused and
 * unexpired — otherwise every share would hand out a link that resolves to nothing.
 * On the hashed-column schema `token` reads back as NULL, so a fresh token is always
 * minted; that is intended, since the raw value is unrecoverable by design.
 *
 * Superseded tokens are stamped `used_at` before the new row is inserted, so an older
 * link cannot keep collecting responses alongside the current one.
 *
 * Returns null when the token could not be issued; the caller decides how loudly to
 * fail. Writes no `ticket_history` — the caller owns that, because "generated" and
 * "shared" are separate events with different actors.
 */
export async function issueCsatLink(
  db: Queryable,
  ticketId: string
): Promise<IssuedCsatLink | null> {
  // `ticket_id` directly: the legacy `request_id` spelling is gone from every
  // deployed shape (confirmed against production 2026-08-29), so probing
  // information_schema for it on each call bought nothing.
  const ticketColumn = "ticket_id"
  const tokenColumn = await getCsatTokenColumn(db)
  const selectExpressions = getCsatTokenSelectExpressions(tokenColumn)

  const [tokenRows] = await db.query<CsatTokenRow[]>(
    `
    SELECT id, ${selectExpressions}, expires_at, used_at
    FROM csat_tokens
    WHERE ${ticketColumn} = ?
    ORDER BY id DESC
    LIMIT 1
  `,
    [ticketId]
  )

  const existing = tokenRows[0] ?? null
  const existingExpiry = existing ? new Date(existing.expires_at) : null
  const reusable =
    Boolean(existing?.token) &&
    !existing?.used_at &&
    existingExpiry !== null &&
    !Number.isNaN(existingExpiry.valueOf()) &&
    existingExpiry.getTime() >= Date.now()

  if (reusable && existing?.token) {
    return { token: existing.token, expiresAt: existing.expires_at, generated: false }
  }

  await db.query(
    `
    UPDATE csat_tokens
    SET used_at = COALESCE(used_at, NOW(3))
    WHERE ${ticketColumn} = ?
      AND used_at IS NULL
  `,
    [ticketId]
  )

  const rawToken = randomUUID()
  const tokenValue = getCsatTokenStorageValue(
    tokenColumn,
    rawToken,
    hashOpaqueToken(rawToken)
  )

  const [insertResult] = await db.query<ResultSetHeader>(
    `
    INSERT INTO csat_tokens (${ticketColumn}, ${tokenColumn}, expires_at)
    VALUES (?, ?, DATE_ADD(NOW(3), INTERVAL ${TOKEN_TTL_DAYS} DAY))
  `,
    [ticketId, tokenValue]
  )

  const [insertedRows] = await db.query<InsertedTokenRow[]>(
    `
    SELECT expires_at
    FROM csat_tokens
    WHERE id = ?
    LIMIT 1
  `,
    [insertResult.insertId]
  )

  const expiresAt = insertedRows[0]?.expires_at ?? null
  if (!expiresAt) {
    return null
  }

  return { token: rawToken, expiresAt, generated: true }
}

/**
 * Absolute URL for the public survey page.
 *
 * Server-side callers cannot read `window.location.origin` the way the tickets page
 * does, so the link is built from `APP_BASE_URL`. A wrong value here sends merchants
 * a dead link, so it is the one env var this feature genuinely requires.
 */
export function buildCsatUrl(token: string): string {
  return `${resolveAppBaseUrl().replace(/\/+$/, "")}/csat/${encodeURIComponent(token)}`
}

// ---------------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------------

/**
 * Mint the survey link and push it to Respond.io for a ticket that just closed.
 *
 * Called from the ticket PATCH route on the transition into a closed status, after
 * the ticket row and its history have been written. Records what happened in
 * `ticket_history` so the audit trail shows it and the ticket page's CSAT status flips
 * to "Send" on the next read -- the same `csat_link_shared` row the manual button
 * writes, which is also what stops a later close from sending twice.
 *
 * Returns the outcome for the response body; never throws.
 */
export async function sendCsatLinkForClosedTicket(params: {
  ticketId: string
  respondioContactId: string | null
  phone: string | null
  merchantName: string | null
  actorId: string
}): Promise<CsatDispatchResult> {
  // Transaction 1: decide and mint. issueCsatLink supersedes any live token and
  // then inserts a replacement — two writes that must not be separable, or a
  // crash between them leaves the ticket with every token consumed and no live
  // one. The generated-token history row belongs with them.
  const link = await withTransaction(async (connection) => {
    const alreadyShared = await hasSharedCsatLink(connection, params.ticketId)
    const decision = resolveCsatAutoSendDecision({
      respondioContactId: params.respondioContactId,
      alreadyShared,
      configured: isCsatAutoSendConfigured(),
    })

    if (!decision.send) {
      return { skipped: decision.reason } as const
    }

    const issued = await issueCsatLink(connection, params.ticketId)
    if (!issued) {
      return null
    }

    if (issued.generated) {
      await insertTicketHistory(
        connection,
        params.ticketId,
        [
          {
            field: "csat_token_generated",
            oldValue: null,
            newValue: "[generated]",
          },
        ],
        params.actorId
      )
    }

    return issued
  })

  if (link && "skipped" in link) {
    return { status: "skipped", reason: link.skipped }
  }
  if (!link) {
    return { status: "failed", error: "Unable to issue a CSAT token." }
  }

  // The dispatch is a network call and stays outside every transaction: holding
  // a row lock open across an HTTP round trip is how a slow upstream turns into
  // database contention.
  const result = await dispatchCsatLink({
    ticketId: params.ticketId,
    // Non-null by the decision above; narrowed here for the type checker.
    respondioContactId: String(params.respondioContactId),
    phone: params.phone,
    merchantName: params.merchantName,
    csatUrl: buildCsatUrl(link.token),
    expiresAt: link.expiresAt,
  })

  // Transaction 2: record the outcome. Nothing else is in it, so there is
  // nothing for a swallowed error to protect — a failure here surfaces rather
  // than leaving the dispatch unrecorded.
  if (result.status === "sent") {
    // NOW(3) rather than a JS timestamp, so the row is byte-identical to the one
    // the manual share button writes and the audit trail renders them the same.
    await withTransaction((connection) =>
      insertTicketHistory(
        connection,
        params.ticketId,
        [
          {
            field: CSAT_SHARED_HISTORY_FIELD,
            oldValue: null,
            newValue: null,
            newValueIsNow: true,
          },
        ],
        params.actorId
      )
    )
  } else if (result.status === "failed") {
    // Recorded rather than dropped: an agent seeing "Not Sent" on a closed ticket
    // needs to know the automation tried, so they fall back to manual share.
    await withTransaction((connection) =>
      insertTicketHistory(
        connection,
        params.ticketId,
        [
          {
            field: CSAT_SEND_FAILED_HISTORY_FIELD,
            oldValue: null,
            newValue: result.error.slice(0, 500),
          },
        ],
        params.actorId
      )
    )
  }

  return result
}

/**
 * True when the survey link already went out for this ticket, by either path.
 *
 * Reads the same history fields the ticket page uses to show "Send", including the two
 * legacy field names older rows carry, so a link shared before this feature existed
 * still suppresses the automatic send.
 */
async function hasSharedCsatLink(
  db: Queryable,
  ticketId: string
): Promise<boolean> {
  const [rows] = await db.query<RowDataPacket[]>(
    `
    SELECT 1
    FROM ticket_history
    WHERE ticket_id = ?
      AND field_name IN ('csat_link_shared', 'csat_link_shared_at', 'csat_whatsapp_sent')
    LIMIT 1
  `,
    [ticketId]
  )
  return rows.length > 0
}

