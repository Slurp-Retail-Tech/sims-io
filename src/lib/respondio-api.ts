/**
 * Respond.io Developer API v2 — the outbound half of renewal messaging.
 *
 * The first direct Respond.io client in this codebase. The existing CSAT path
 * posts to an n8n webhook which then calls Respond.io, which is fine for
 * fire-and-forget, but renewal dispatch needs what the relay cannot return:
 * the message id to record against each dispatch row, the ability to tag a
 * contact created for a payer, and the ability to close that contact's
 * conversation so it does not sit unassigned in the Merchant Success inbox.
 *
 * Contract, matching `httpFetch` and `dispatchCsatLink`: **never throws.**
 * Every failure comes back as a discriminated union. A messaging failure must
 * not abort the surrounding SIMS operation — the invoice exists, the payment
 * happened, and a failed send is a row to retry, not an exception to unwind.
 *
 * Rate limit: the API allows 5 requests per second per HTTP method, at the
 * organisation level. This client honours `Retry-After` on a 429; the pacing
 * itself belongs to the dispatch queue, which is what actually controls how
 * fast sends are attempted.
 */

import { httpFetch, parseRetryAfterMs } from "./http.ts"
import { createLogger } from "./logger.ts"

const log = createLogger("respondio-api")

const DEFAULT_BASE_URL = "https://api.respond.io/v2"
const TIMEOUT_MS = 15_000

export type RespondioResult<T> =
  | { ok: true; value: T }
  /** Configuration is absent; nothing was attempted. */
  | { ok: false; reason: "not_configured" }
  | {
      ok: false
      reason: "failed"
      status: number | null
      error: string
      /** From `Retry-After` on a 429, when Respond.io sent one. */
      retryAfterMs?: number | null
    }

export type RespondioChannel = {
  id: number
  name: string
  source: string
}

export type SendMessageResult = { messageId: number }

function readConfig(): { baseUrl: string; token: string } | null {
  const token = process.env.RESPONDIO_API_TOKEN?.trim()
  if (!token) {
    return null
  }
  const baseUrl = (
    process.env.RESPONDIO_API_BASE_URL?.trim() || DEFAULT_BASE_URL
  ).replace(/\/+$/, "")
  return { baseUrl, token }
}

/** True when this environment can send. Drives the dispatch job's guard. */
export function isRespondioApiConfigured(): boolean {
  return readConfig() !== null
}

async function call<T>(
  path: string,
  init: { method: string; body?: unknown; label: string; attempts?: number }
): Promise<RespondioResult<T>> {
  const config = readConfig()
  if (!config) {
    return { ok: false, reason: "not_configured" }
  }

  try {
    const response = await httpFetch(`${config.baseUrl}${path}`, {
      method: init.method,
      headers: {
        Authorization: `Bearer ${config.token}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      label: init.label,
      timeoutMs: TIMEOUT_MS,
      attempts: init.attempts ?? 1,
      cache: "no-store",
    })

    const text = await response.text().catch(() => "")

    if (!response.ok) {
      // 449 is Respond.io's "retry shortly": a contact created a moment ago is
      // not always immediately addressable.
      return {
        ok: false,
        reason: "failed",
        status: response.status,
        error: text ? text.slice(0, 300) : `HTTP ${response.status}`,
        retryAfterMs: response.status === 429 ? parseRetryAfterMs(response.headers.get("retry-after")) : null,
      }
    }

    return { ok: true, value: (text ? JSON.parse(text) : null) as T }
  } catch (error) {
    return {
      ok: false,
      reason: "failed",
      status: null,
      error: error instanceof Error ? error.message : "Unknown error",
    }
  }
}

/** The workspace's channels, which is how an email or WhatsApp channel id is found. */
export async function listChannels(): Promise<RespondioResult<RespondioChannel[]>> {
  return call<RespondioChannel[]>("/space/channel", {
    method: "GET",
    label: "respondio.listChannels",
    // Idempotent, so worth retrying — this runs at startup and during setup.
    attempts: 3,
  })
}

/**
 * Create the contact if the identifier is unknown, otherwise update it.
 *
 * *** DO NOT call this to "make sure the contact exists" before sending. ***
 *
 * Two reasons, both confirmed against the live workspace on 17 September 2026:
 *
 *  1. It is unnecessary. An `email:` or `phone:` identifier creates the contact
 *     implicitly on first write, so `sendMessage` alone is enough. A test send
 *     to an address with no prior contact needs no preparation.
 *
 *  2. It is destructive. A test send to an address that *did* already have a
 *     contact resolved to that existing person — the right behaviour, and what
 *     the payer-email flow depends on when the payer is also the renewal PIC.
 *     But this endpoint *updates* on a match, so passing a `firstName` here
 *     would overwrite a real merchant contact's name with whatever SIMS
 *     happened to know, and Respond.io keeps no previous value to restore.
 *
 * Use it only where changing the contact's stored details is the actual
 * intent, and pass only the fields that should genuinely be overwritten.
 */
export async function createOrUpdateContact(
  identifier: string,
  fields: { firstName?: string; lastName?: string; email?: string; phone?: string }
): Promise<RespondioResult<{ id: number }>> {
  return call<{ id: number }>(
    `/contact/create_or_update/${encodeURIComponent(identifier)}`,
    {
      method: "POST",
      body: fields,
      label: "respondio.createOrUpdateContact",
    }
  )
}

/**
 * Send one message.
 *
 * Creates the contact implicitly where the identifier is unknown, so nothing
 * needs to exist beforehand — see the warning on `createOrUpdateContact`.
 *
 * Deliberately **not** retried. A timeout here is the dangerous case: the
 * message may well have been delivered, and a retry would send a merchant a
 * second copy. The dispatch row records the attempt either way, and a human
 * decides. This follows the same reasoning as `dispatchCsatLink`.
 */
export async function sendMessage(
  identifier: string,
  payload: unknown
): Promise<RespondioResult<SendMessageResult>> {
  const result = await call<SendMessageResult>(
    `/contact/${encodeURIComponent(identifier)}/message`,
    {
      method: "POST",
      body: payload,
      label: "respondio.sendMessage",
      attempts: 1,
    }
  )

  if (!result.ok && result.reason === "failed") {
    log.warn("Respond.io send failed", {
      status: result.status,
      error: result.error,
    })
  }

  return result
}

/** Tag a contact, so one created only to receive documents is recognisable. */
export async function addTags(
  identifier: string,
  tags: readonly string[]
): Promise<RespondioResult<null>> {
  if (tags.length === 0 || tags.length > 10) {
    return {
      ok: false,
      reason: "failed",
      status: null,
      error: "Between 1 and 10 tags per call.",
    }
  }
  return call<null>(`/contact/${encodeURIComponent(identifier)}/tag`, {
    method: "POST",
    body: [...tags],
    label: "respondio.addTags",
  })
}

/**
 * Close a conversation with a note.
 *
 * Used immediately after a payer email so a person who is not a merchant
 * contact does not leave an open, unassigned conversation in the Merchant
 * Success inbox. A reply from them reopens it normally, which is the intended
 * behaviour.
 */
export async function closeConversation(
  identifier: string,
  summary: string
): Promise<RespondioResult<null>> {
  return call<null>(
    `/contact/${encodeURIComponent(identifier)}/conversation/status`,
    {
      method: "POST",
      body: { status: "close", category: "Resolved", summary },
      label: "respondio.closeConversation",
    }
  )
}
