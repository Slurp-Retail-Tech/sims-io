/**
 * Respond.io -> SIMS orchestration: the database-touching half of the integration.
 *
 * All the decisions live in pure modules that this file calls:
 *   - `respondio-resolution.ts`  which contact an event resolves to, and how a
 *                                ticket links to an outlet
 *   - `respondio-ticket-defaults.ts`  what goes in the ticket's NOT NULL columns
 *   - `contact-mappings.ts`      whether a new mapping would be redundant
 *   - `respondio-secrets.ts`     shared-secret hashing and comparison
 *
 * The endpoint that calls into here is `src/app/api/integrations/respond-io/route.ts`.
 */

import { queryWithReconnect, withTransaction } from "@/lib/db"
import type { Queryable } from "@/lib/db"
import { isCoveredByFranchiseWide } from "@/lib/contact-mappings"
import type { ContactMapping } from "@/lib/contact-mappings"
import { resolveMerchantNames } from "@/lib/merchant-outlet-resolution"
import { insertTicketHistory } from "@/lib/ticket-history"
import {
  normalizePhone,
  resolveContactCandidate,
  resolveOutletMatch,
} from "@/lib/respondio-resolution"
import type {
  ContactMatch,
  ContactMatchCandidate,
  RespondioEvent,
} from "@/lib/respondio-resolution"
import {
  RESPONDIO_ACTOR,
  RESPONDIO_CLOSED_STATUS,
  RESPONDIO_IN_PROGRESS_STATUS,
  RESPONDIO_TICKET_STATUS,
  buildRespondioTicketInsert,
} from "@/lib/respondio-ticket-defaults"
import { secretsMatch } from "@/lib/respondio-secrets"
import type {
  PoolConnection,
  ResultSetHeader,
  RowDataPacket,
} from "mysql2/promise"

/** The module's open-state values. A ticket is "open" until it is Resolved. */
const OPEN_STATUSES = ["Open", "In Progress", "Pending Customer"] as const

export type WebhookProcessingStatus =
  | "processing"
  | "processed"
  | "ignored"
  | "rejected"
  | "noop"
  | "failed"

export type EventOutcome = {
  status: WebhookProcessingStatus
  summary: string
  ticketId: string | null
  error?: string
}

// ---------------------------------------------------------------------------
// Settings and secrets
// ---------------------------------------------------------------------------

export type RespondioSettings = {
  routingTag: string
  updatedAt: string | null
  updatedBy: string | null
}

const DEFAULT_ROUTING_TAG = "team:merchant_success"

export async function loadRespondioSettings(): Promise<RespondioSettings> {
  const [rows] = await queryWithReconnect<
    Array<
      RowDataPacket & {
        routing_tag: string
        updated_at: string | null
        updated_by: string | null
      }
    >
  >(`SELECT routing_tag, updated_at, updated_by FROM respondio_settings WHERE id = 1`)

  const row = rows[0]
  return {
    routingTag: row?.routing_tag ?? DEFAULT_ROUTING_TAG,
    updatedAt: row?.updated_at ?? null,
    updatedBy: row?.updated_by ?? null,
  }
}

export async function saveRespondioSettings(
  routingTag: string,
  updatedBy: string
): Promise<void> {
  await queryWithReconnect(
    `INSERT INTO respondio_settings (id, routing_tag, updated_by)
     VALUES (1, ?, ?)
     ON DUPLICATE KEY UPDATE routing_tag = VALUES(routing_tag), updated_by = VALUES(updated_by)`,
    [routingTag, updatedBy]
  )
}

/**
 * Verify a presented secret against every non-revoked key.
 *
 * More than one key may be active at a time: rotation issues a new key while the
 * previous one keeps verifying, so n8n can be updated without dropping in-flight
 * events. Returns the matching `key_id` for logging, or null.
 *
 * Falls back to `RESPONDIO_WEBHOOK_SECRET` when no key row exists at all, so a fresh
 * environment works before anyone opens the settings page.
 */
export async function verifySharedSecret(
  provided: string | null
): Promise<{ valid: boolean; keyId: string | null }> {
  if (!provided) {
    return { valid: false, keyId: null }
  }

  const [rows] = await queryWithReconnect<
    Array<RowDataPacket & { id: number | string; key_id: string; secret_hash: string }>
  >(
    `SELECT id, key_id, secret_hash
     FROM respondio_integration_secrets
     WHERE revoked_at IS NULL
     ORDER BY created_at DESC`
  )

  if (!rows.length) {
    const envSecret = process.env.RESPONDIO_WEBHOOK_SECRET?.trim()
    if (envSecret && provided === envSecret) {
      return { valid: true, keyId: "env" }
    }
    return { valid: false, keyId: null }
  }

  for (const row of rows) {
    if (secretsMatch(provided, row.secret_hash)) {
      // Best-effort: knowing which key is live matters for rotation, but a failed
      // bookkeeping update must not reject an otherwise valid call.
      await queryWithReconnect(
        `UPDATE respondio_integration_secrets SET last_used_at = CURRENT_TIMESTAMP(3) WHERE id = ?`,
        [row.id]
      ).catch((error) => {
        console.error("Failed to record Respond.io secret usage", error)
      })
      return { valid: true, keyId: row.key_id }
    }
  }

  return { valid: false, keyId: null }
}

// ---------------------------------------------------------------------------
// Event ledger / idempotency
// ---------------------------------------------------------------------------

const DUPLICATE_ENTRY_CODE = "ER_DUP_ENTRY"

/**
 * Claim an event by inserting the ledger row first.
 *
 * Insert-first is what makes redelivery safe without a read-then-write race: the
 * UNIQUE key on `idempotency_key` decides the winner, and the loser sees
 * `ER_DUP_ENTRY` and returns having done nothing. A check-then-insert would let two
 * concurrent deliveries both pass the check.
 *
 * Returns null when the event was already claimed.
 */
export async function claimWebhookEvent(params: {
  eventType: string
  respondioContactId: string | null
  idempotencyKey: string
  payloadRaw: unknown
  secretValid: boolean
  initialStatus?: WebhookProcessingStatus
  errorMessage?: string | null
  resultSummary?: string | null
}): Promise<string | null> {
  try {
    const [result] = await queryWithReconnect<ResultSetHeader>(
      `INSERT INTO respondio_webhook_events (
         event_type, respondio_contact_id, idempotency_key, payload_raw,
         secret_valid, processing_status, error_message, result_summary, processed_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        params.eventType,
        params.respondioContactId,
        params.idempotencyKey,
        JSON.stringify(params.payloadRaw ?? null),
        params.secretValid ? 1 : 0,
        params.initialStatus ?? "processing",
        params.errorMessage ?? null,
        params.resultSummary ?? null,
        params.initialStatus && params.initialStatus !== "processing"
          ? new Date()
          : null,
      ]
    )
    return String(result.insertId)
  } catch (error) {
    if ((error as { code?: string }).code === DUPLICATE_ENTRY_CODE) {
      return null
    }
    throw error
  }
}

export async function completeWebhookEvent(
  eventRowId: string,
  outcome: EventOutcome
): Promise<void> {
  await queryWithReconnect(
    `UPDATE respondio_webhook_events
     SET processing_status = ?, result_summary = ?, error_message = ?, ticket_id = ?,
         processed_at = CURRENT_TIMESTAMP(3)
     WHERE id = ?`,
    [
      outcome.status,
      outcome.summary.slice(0, 255),
      outcome.error ?? null,
      outcome.ticketId,
      eventRowId,
    ]
  )
}

// ---------------------------------------------------------------------------
// Contact resolution
// ---------------------------------------------------------------------------

export type ResolvedContact = {
  contactId: string
  contactName: string | null
  matchedBy: ContactMatch["matchedBy"] | "created"
  softDeleted: boolean
}

/**
 * Resolve (or create) the SIMS contact behind an inbound event.
 *
 * Candidates are fetched by the three keys the PRD matches on and handed to the pure
 * `resolveContactCandidate`, which owns the ordering. Soft-deleted contacts are
 * included in the candidate set on purpose: excluding them would silently duplicate a
 * contact staff deliberately deleted on the very next inbound event. The
 * `softDeleted` flag is what stops the caller auto-linking against a hidden record.
 *
 * Runs on the caller's transaction connection so the lookup and the auto-create are
 * atomic -- two events for the same new contact would otherwise both miss and both
 * insert, and `contacts.respondio_contact_id` is UNIQUE.
 */
export async function resolveSimsContact(
  connection: PoolConnection,
  event: RespondioEvent
): Promise<ResolvedContact> {
  const inboundPhone = normalizePhone(event.contactPhone)
  const inboundEmail = event.contactEmail?.trim().toLowerCase() ?? null

  // Match on the subscriber tail so "+60162207781" also finds "0162207781". Guarded on
  // a minimum length: a two-digit tail would drag in most of the table as candidates.
  // This only widens the candidate set — `resolveContactCandidate` still decides the
  // match with an exact comparison.
  const phoneTail = inboundPhone.replace(/^\+?60/, "").replace(/^0/, "")
  const phonePattern = phoneTail.length >= 6 ? `%${phoneTail}` : inboundPhone

  const [rows] = await connection.query<
    Array<
      RowDataPacket & {
        id: number | string
        name: string
        email: string | null
        respondio_contact_id: string | null
        deleted_at: string | null
        phones: string | null
      }
    >
  >(
    `SELECT
       contacts.id,
       contacts.name,
       contacts.email,
       contacts.respondio_contact_id,
       contacts.deleted_at,
       GROUP_CONCAT(contact_phone_numbers.phone_normalized) AS phones
     FROM contacts
     LEFT JOIN contact_phone_numbers
       ON contact_phone_numbers.contact_id = contacts.id
     WHERE contacts.respondio_contact_id = ?
        OR (? <> '' AND LOWER(contacts.email) = ?)
        OR contacts.id IN (
             SELECT contact_id FROM contact_phone_numbers
             WHERE ? <> '' AND phone_normalized LIKE ?
           )
     GROUP BY contacts.id`,
    [
      event.respondioContactId,
      inboundEmail ?? "",
      inboundEmail ?? "",
      inboundPhone,
      phonePattern,
    ]
  )

  const candidates: ContactMatchCandidate[] = rows.map((row) => ({
    id: String(row.id),
    email: row.email,
    respondioContactId: row.respondio_contact_id,
    phonesNormalized: row.phones ? row.phones.split(",") : [],
    deletedAt: row.deleted_at,
  }))

  const match = resolveContactCandidate(event, candidates)

  if (match) {
    const matched = rows.find((row) => String(row.id) === match.contactId)

    // Backfill the Respond.io id on a phone/email match so the next event resolves
    // by id directly (PRD AC9). Never on a soft-deleted contact: that would quietly
    // re-attach a hidden record to a live conversation.
    if (match.matchedBy !== "respondio_id" && !match.softDeleted) {
      await connection.query(
        `UPDATE contacts SET respondio_contact_id = ? WHERE id = ? AND respondio_contact_id IS NULL`,
        [event.respondioContactId, match.contactId]
      )
    }

    return {
      contactId: match.contactId,
      contactName: matched?.name ?? null,
      matchedBy: match.matchedBy,
      softDeleted: match.softDeleted,
    }
  }

  return createContactFromEvent(connection, event)
}

/**
 * Auto-create a contact for an inbound event with no match.
 *
 * Deliberately does NOT go through the manual-creation duplicate-blocking flow: no
 * staff member is present to choose between an existing contact and a new one, and
 * blocking would mean dropping the conversation on the floor (PRD 4.7).
 *
 * `email` is NOT NULL on `contacts`, but Respond.io contacts often have only a phone,
 * so a synthetic placeholder keyed to the Respond.io id is stored. It is unique per
 * contact, so it never collides with another auto-created row, and it is obviously
 * not a real address.
 */
async function createContactFromEvent(
  connection: PoolConnection,
  event: RespondioEvent
): Promise<ResolvedContact> {
  const name = event.contactName?.trim() || `Respond.io ${event.respondioContactId}`
  const email =
    event.contactEmail?.trim().toLowerCase() ||
    `${event.respondioContactId}@respondio.invalid`
  const phone = event.contactPhone?.trim() ?? ""

  const [result] = await connection.query<ResultSetHeader>(
    `INSERT INTO contacts (name, email, role, source, respondio_contact_id, created_by_user_id)
     VALUES (?, ?, NULL, 'respond_io', ?, NULL)`,
    [name, email, event.respondioContactId]
  )

  const contactId = String(result.insertId)

  if (phone) {
    await connection.query(
      `INSERT INTO contact_phone_numbers (contact_id, phone, phone_normalized, is_primary)
       VALUES (?, ?, ?, 1)`,
      [contactId, phone, normalizePhone(phone)]
    )
  }

  return { contactId, contactName: name, matchedBy: "created", softDeleted: false }
}

async function loadMappings(
  connection: PoolConnection,
  contactId: string
): Promise<ContactMapping[]> {
  const [rows] = await connection.query<
    Array<
      RowDataPacket & {
        id: number | string
        franchise_id: string
        outlet_id: string | null
      }
    >
  >(
    `SELECT id, franchise_id, outlet_id FROM contact_outlets WHERE contact_id = ?`,
    [contactId]
  )

  return rows.map((row) => ({
    id: String(row.id),
    franchiseId: row.franchise_id,
    outletId: row.outlet_id,
  }))
}

// ---------------------------------------------------------------------------
// Event handlers
// ---------------------------------------------------------------------------

/**
 * Contact Tag Updated -> create a Merchant Success ticket.
 *
 * Ignores any tag other than the configured routing tag (PRD AC2), and refuses to
 * create a second ticket while one is still open for the same Respond.io contact
 * (PRD 4.8) -- a customer re-tagged mid-conversation should not fan out into duplicates.
 */
export async function handleContactTagUpdated(
  event: RespondioEvent,
  routingTag: string
): Promise<EventOutcome> {
  if (!event.tag || event.tag.trim().toLowerCase() !== routingTag.trim().toLowerCase()) {
    return {
      status: "ignored",
      summary: `Tag ${event.tag ?? "(none)"} does not match routing tag`,
      ticketId: null,
    }
  }

  return withTransaction(async (connection) => {
    // Serialize per contact for the whole check-then-create. The duplicate
    // check below is a read-then-write, so without this two genuinely distinct
    // events for one contact can both see "no open ticket" and both insert.
    // (Retries are already deduped by respondio_webhook_events; this covers the
    // distinct-event case that ledger cannot.) There is no ticket row to lock
    // yet, hence an advisory lock rather than SELECT ... FOR UPDATE.
    await connection.query(`SELECT GET_LOCK(?, 5)`, [
      `respondio:contact:${event.respondioContactId}`,
    ])

    const existing = await findOpenTicket(event.respondioContactId, connection)
    if (existing) {
      return {
        status: "noop" as const,
        summary: `Ticket #${existing.id} already open for this contact`,
        ticketId: existing.id,
      }
    }

    const contact = await resolveSimsContact(connection, event)

    // A soft-deleted contact must not drive auto-linking or a franchise pre-fill; the
    // ticket is flagged for manual review instead (PRD AC11).
    const mappings = contact.softDeleted
      ? []
      : await loadMappings(connection, contact.contactId)
    const decision = resolveOutletMatch(mappings)

    // On `connection`, not `pool`: reading through the pool here would check
    // out a second connection while this transaction holds the first.
    const names = await resolveMerchantNames(
      connection,
      decision.fid,
      decision.oid
    )

    const row = buildRespondioTicketInsert(event, decision, {
      contactId: contact.softDeleted ? null : contact.contactId,
      contactName: contact.contactName,
      franchiseName: names.franchiseName,
      outletName: names.outletName,
    })

    const columns = Object.keys(row)
    const [result] = await connection.query<ResultSetHeader>(
      `INSERT INTO tickets (${columns.join(", ")})
       VALUES (${columns.map(() => "?").join(", ")})`,
      columns.map((column) => row[column as keyof typeof row])
    )

    const ticketId = String(result.insertId)

    await insertTicketHistory(
      connection,
      ticketId,
      [{ field: "source", oldValue: null, newValue: "respond_io" }],
      RESPONDIO_ACTOR
    )

    return {
      status: "processed" as const,
      summary: buildTicketSummary(ticketId, decision.action, contact),
      ticketId,
    }
  })
}

function buildTicketSummary(
  ticketId: string,
  action: string,
  contact: ResolvedContact
): string {
  const contactPart =
    contact.matchedBy === "created"
      ? "Contact auto-created"
      : contact.softDeleted
        ? "Resolved contact is deleted"
        : `Contact matched by ${contact.matchedBy}`

  const linkPart =
    action === "auto_link"
      ? "outlet auto-linked"
      : action === "franchise_prefill"
        ? "franchise pre-filled"
        : "needs_outlet_match"

  return `Ticket #${ticketId} created · ${contactPart} · ${linkPart}`
}

/**
 * Contact Assignee Updated -> set the ticket's MS PIC.
 *
 * An email with no matching SIMS user leaves `ms_pic_user_id` untouched and is logged
 * as an unmatched-agent case (PRD 4.6) rather than clearing the assignment -- losing a
 * correct assignment because Respond.io holds an unknown address would be worse than
 * a stale one.
 */
export async function handleAssigneeUpdated(
  event: RespondioEvent
): Promise<EventOutcome> {
  const ticket = await findOpenTicket(event.respondioContactId)
  if (!ticket) {
    return {
      status: "noop",
      summary: "No open ticket for this contact",
      ticketId: null,
    }
  }

  const ticketId = ticket.id
  const email = event.assigneeEmail?.trim().toLowerCase()
  if (!email) {
    return { status: "ignored", summary: "Event carried no assignee email", ticketId }
  }

  const [users] = await queryWithReconnect<
    Array<RowDataPacket & { id: number | string; name: string }>
  >(`SELECT id, name FROM users WHERE LOWER(email) = ? LIMIT 1`, [email])

  const user = users[0]
  if (!user) {
    return {
      status: "processed",
      summary: `Unmatched agent ${email}; MS PIC left unchanged`,
      ticketId,
    }
  }

  // The update and its history row are one unit: a crash between them would
  // leave the ticket reassigned with no audit trail of who moved it.
  await withTransaction(async (connection) => {
    await connection.query(
      `UPDATE tickets SET ms_pic_user_id = ?, updated_by = ? WHERE id = ?`,
      [user.id, RESPONDIO_ACTOR, ticketId]
    )
    await insertTicketHistory(
      connection,
      ticketId,
      [
        {
          field: "ms_pic_user_id",
          oldValue: null,
          newValue: String(user.id),
        },
      ],
      RESPONDIO_ACTOR
    )
  })

  return {
    status: "processed",
    summary: `MS PIC set to ${user.name}`,
    ticketId,
  }
}

/**
 * New Outgoing Message (an agent's own reply) -> move an Open ticket to In Progress.
 *
 * "First message" is enforced by the status guard rather than by counting messages:
 * only a ticket still sitting at `Open` is advanced, so every later reply on the same
 * conversation is a no-op. That keeps the rule stateless -- no message ledger to keep
 * in sync -- and, more importantly, never drags a ticket an agent has since moved to
 * `Pending Customer` back to `In Progress` just because they answered again.
 *
 * Only a human agent's outgoing messages reach here: the n8n workflow subscribes to
 * Respond.io's New Outgoing Message trigger with Event Source pinned to `user`, so bot,
 * AI Agent, workflow and API sends never advance a ticket.
 */
export async function handleMessageSent(
  event: RespondioEvent
): Promise<EventOutcome> {
  const ticket = await findOpenTicket(event.respondioContactId)
  if (!ticket) {
    return {
      status: "noop",
      summary: "No open ticket for this contact",
      ticketId: null,
    }
  }

  if (ticket.status !== RESPONDIO_TICKET_STATUS) {
    return {
      status: "noop",
      summary: `Ticket #${ticket.id} is already ${ticket.status}`,
      ticketId: ticket.id,
    }
  }

  // The status read above is unlocked, so it can be stale by the time we write.
  // Re-read FOR UPDATE inside the transaction and bail before writing anything:
  // previously the UPDATE was guarded by `AND status = ?` but the history INSERT
  // was not, so a lost race recorded a transition that never happened.
  const moved = await withTransaction(async (connection) => {
    const [rows] = await connection.query<
      Array<RowDataPacket & { status: string }>
    >(`SELECT status FROM tickets WHERE id = ? FOR UPDATE`, [ticket.id])

    const current = rows[0]?.status
    if (current !== RESPONDIO_TICKET_STATUS) {
      return current ?? null
    }

    await connection.query(
      `UPDATE tickets SET status = ?, updated_by = ? WHERE id = ?`,
      [RESPONDIO_IN_PROGRESS_STATUS, RESPONDIO_ACTOR, ticket.id]
    )
    await insertTicketHistory(
      connection,
      ticket.id,
      [
        {
          field: "status",
          oldValue: RESPONDIO_TICKET_STATUS,
          newValue: RESPONDIO_IN_PROGRESS_STATUS,
        },
      ],
      RESPONDIO_ACTOR
    )
    return true
  })

  if (moved !== true) {
    return {
      status: "noop",
      summary:
        moved === null
          ? `Ticket #${ticket.id} no longer exists`
          : `Ticket #${ticket.id} is already ${moved}`,
      ticketId: ticket.id,
    }
  }

  return {
    status: "processed",
    summary: `Ticket #${ticket.id} moved to ${RESPONDIO_IN_PROGRESS_STATUS}`,
    ticketId: ticket.id,
  }
}

/** Conversation Closed -> resolve the ticket and stamp `closed_at`. */
export async function handleConversationClosed(
  event: RespondioEvent
): Promise<EventOutcome> {
  const ticket = await findOpenTicket(event.respondioContactId)
  if (!ticket) {
    return {
      status: "noop",
      summary: "No open ticket for this contact",
      ticketId: null,
    }
  }

  const ticketId = ticket.id

  // Closing the ticket and recording the close are one unit — a half-applied
  // close is a ticket that looks resolved with nothing saying who resolved it.
  // The old_value is read under the lock so it reflects what was actually
  // replaced rather than the unlocked read above.
  await withTransaction(async (connection) => {
    const [rows] = await connection.query<
      Array<RowDataPacket & { status: string }>
    >(`SELECT status FROM tickets WHERE id = ? FOR UPDATE`, [ticketId])

    await connection.query(
      `UPDATE tickets
       SET status = ?, closed_at = CURRENT_TIMESTAMP(3), updated_by = ?
       WHERE id = ?`,
      [RESPONDIO_CLOSED_STATUS, RESPONDIO_ACTOR, ticketId]
    )
    await insertTicketHistory(
      connection,
      ticketId,
      [
        {
          field: "status",
          oldValue: rows[0]?.status ?? null,
          newValue: RESPONDIO_CLOSED_STATUS,
        },
      ],
      RESPONDIO_ACTOR
    )
  })

  return {
    status: "processed",
    summary: `Ticket #${ticketId} closed`,
    ticketId,
  }
}

type OpenTicket = { id: string; status: string }

/**
 * `db` is optional so a caller inside a transaction can pass its connection and
 * have the duplicate check see the same snapshot as the insert that follows.
 * Standalone callers keep the reconnecting pool path.
 */
async function findOpenTicket(
  respondioContactId: string,
  db?: Queryable
): Promise<OpenTicket | null> {
  const placeholders = OPEN_STATUSES.map(() => "?").join(", ")
  const sql = `SELECT id, status FROM tickets
     WHERE respondio_contact_id = ? AND status IN (${placeholders})
     ORDER BY created_at DESC
     LIMIT 1`
  const values = [respondioContactId, ...OPEN_STATUSES]
  const [rows] = db
    ? await db.query<Array<RowDataPacket & { id: number | string; status: string }>>(
        sql,
        values
      )
    : await queryWithReconnect<
        Array<RowDataPacket & { id: number | string; status: string }>
      >(sql, values)

  const row = rows[0]
  return row ? { id: String(row.id), status: row.status } : null
}

/**
 * Persist the mapping an agent confirmed by manually linking a ticket to an outlet.
 *
 * Skipped when the contact already holds a franchise-wide mapping covering that
 * franchise: the new row would be redundant, and the Contacts overlap rule forbids it
 * (PRD AC13). Returns whether a row was written, so the UI can say which happened.
 */
export async function persistManualOutletMapping(
  connection: PoolConnection,
  params: {
    contactId: string
    franchiseId: string
    outletId: string
    userId: string
  }
): Promise<{ inserted: boolean }> {
  const mappings = await loadMappings(connection, params.contactId)

  if (isCoveredByFranchiseWide(mappings, params.franchiseId)) {
    return { inserted: false }
  }

  const alreadyExact = mappings.some(
    (mapping) =>
      mapping.franchiseId === params.franchiseId &&
      mapping.outletId === params.outletId
  )
  if (alreadyExact) {
    return { inserted: false }
  }

  await connection.query(
    `INSERT INTO contact_outlets (contact_id, franchise_id, outlet_id, created_by_user_id)
     VALUES (?, ?, ?, ?)`,
    [params.contactId, params.franchiseId, params.outletId, params.userId]
  )

  return { inserted: true }
}
