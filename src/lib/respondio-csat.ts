/**
 * SIMS -> Respond.io: send the CSAT survey link when a ticket is closed.
 *
 * This is the integration's only outbound direction. The four existing Respond.io
 * flows are inbound (n8n -> `POST /api/integrations/respond-io`); here SIMS posts to
 * an n8n webhook and n8n sends the WhatsApp message through its Respond.io node.
 * Going through n8n rather than calling `api.respond.io` directly keeps the transport
 * on the n8n integration the rest of this feature already uses -- Respond.io's own
 * Webhooks and HTTP Request steps are Advanced-plan features (see `n8n/README.md`).
 *
 * Kept free of `@/`-aliased imports so the decision half can be unit-tested directly
 * under `node --test`, which does not resolve that alias — relative imports are fine.
 * The database-touching orchestrator that calls into here is
 * `sendCsatLinkForClosedTicket` in `src/lib/csat-link.ts`.
 */

/** `ticket_history.field_name` written once the link has actually gone out. */
export const CSAT_SHARED_HISTORY_FIELD = "csat_link_shared"
/** `ticket_history.field_name` written when a send was attempted and failed. */
export const CSAT_SEND_FAILED_HISTORY_FIELD = "csat_auto_send_failed"

/** How long to wait on the n8n webhook before giving up on the send. */
const DISPATCH_TIMEOUT_MS = 10_000

export type CsatAutoSendSkipReason =
  | "not_configured"
  | "no_respondio_contact"
  | "already_shared"

export type CsatAutoSendDecision =
  | { send: true }
  | { send: false; reason: CsatAutoSendSkipReason }

export type CsatAutoSendInputs = {
  /** Respond.io contact behind the ticket; null for support-form / manual tickets. */
  respondioContactId: string | null
  /** True when a `csat_link_shared` history row already exists for the ticket. */
  alreadyShared: boolean
  /** False when `RESPONDIO_CSAT_WEBHOOK_URL` is unset. */
  configured: boolean
}

/**
 * Decide whether closing this ticket should push a CSAT link to Respond.io.
 *
 * Three guards, each of which would otherwise cause a visible support failure:
 *
 * - no Respond.io contact -> there is no conversation to send into. Support-form and
 *   manually created tickets keep using the WhatsApp share button on the ticket page.
 * - already shared -> an agent who sent the link by hand before closing must not have
 *   the merchant receive a second survey seconds later.
 * - not configured -> an environment with no webhook URL (local dev, a fresh deploy)
 *   silently does nothing rather than logging a failure on every close.
 */
export function resolveCsatAutoSendDecision(
  inputs: CsatAutoSendInputs
): CsatAutoSendDecision {
  if (!inputs.configured) {
    return { send: false, reason: "not_configured" }
  }
  if (!inputs.respondioContactId?.trim()) {
    return { send: false, reason: "no_respondio_contact" }
  }
  if (inputs.alreadyShared) {
    return { send: false, reason: "already_shared" }
  }
  return { send: true }
}

/**
 * Re-exported so this module stays the one place the send path imports from. The copy
 * itself lives in `csat-message.ts`, shared with the manual WhatsApp share button so
 * the two can no longer drift. Imported as well as re-exported, because
 * `dispatchCsatLink` composes the body itself and a bare `export ... from` would not
 * bind the name in this module's scope.
 */
import { buildCsatMessage } from "./csat-message.ts"

import { httpFetch } from "./http.ts"

export { buildCsatMessage }

export type CsatDispatchResult =
  | { status: "sent" }
  | { status: "skipped"; reason: CsatAutoSendSkipReason }
  | { status: "failed"; error: string }

export type CsatDispatchParams = {
  ticketId: string
  respondioContactId: string
  /** Fallback identifier for n8n when the contact id no longer resolves. */
  phone: string | null
  merchantName: string | null
  csatUrl: string
  expiresAt: string
}

function readWebhookConfig(): { url: string; secret: string | null } | null {
  const url = process.env.RESPONDIO_CSAT_WEBHOOK_URL?.trim()
  if (!url) {
    return null
  }
  return { url, secret: process.env.RESPONDIO_CSAT_WEBHOOK_SECRET?.trim() || null }
}

/** True when this environment is wired up to send. Drives the decision's guard. */
export function isCsatAutoSendConfigured(): boolean {
  return readWebhookConfig() !== null
}

/**
 * POST the survey link to the n8n webhook that sends it through Respond.io.
 *
 * `idempotencyKey` is derived from the ticket and the token, not from a timestamp, so
 * a retried delivery of the same link is recognisable downstream; n8n has no ledger of
 * its own, but the key gives it something stable to deduplicate on.
 *
 * Never throws: every failure is returned as `{ status: "failed" }`. The caller has
 * already committed the ticket close, and turning a messaging hiccup into a failed
 * PATCH would tell the agent their close did not happen when it did.
 */
export async function dispatchCsatLink(
  params: CsatDispatchParams
): Promise<CsatDispatchResult> {
  const config = readWebhookConfig()
  if (!config) {
    return { status: "skipped", reason: "not_configured" }
  }

  const headers: Record<string, string> = { "content-type": "application/json" }
  if (config.secret) {
    headers["x-sims-webhook-secret"] = config.secret
  }

  try {
    // Not retried: the payload carries an idempotencyKey for n8n, but a resend
    // still risks a duplicate WhatsApp message to a merchant if n8n's own
    // dedupe window has passed. One attempt, reported honestly.
    const response = await httpFetch(config.url, {
      method: "POST",
      label: "respondioCsat.dispatch",
      timeoutMs: DISPATCH_TIMEOUT_MS,
      headers,
      body: JSON.stringify({
        event: "csat_link_send",
        ticketId: params.ticketId,
        respondioContactId: params.respondioContactId,
        phone: params.phone,
        merchantName: params.merchantName,
        csatUrl: params.csatUrl,
        expiresAt: params.expiresAt,
        message: buildCsatMessage(params.csatUrl),
        idempotencyKey: `csat:${params.ticketId}:${params.csatUrl}`,
      }),
      cache: "no-store",
    })

    if (!response.ok) {
      const detail = await response.text().catch(() => "")
      return {
        status: "failed",
        error: `n8n responded ${response.status}${detail ? `: ${detail.slice(0, 200)}` : ""}`,
      }
    }

    return { status: "sent" }
  } catch (error) {
    return {
      status: "failed",
      error: error instanceof Error ? error.message : "Unknown dispatch error",
    }
  }
}
