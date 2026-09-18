/**
 * Pushing a renewed expiry date to the POS.
 *
 * `PATCH /api/outlet-valid-until/{fid}/{oid}` with `{ "valid_until":
 * "2026-09-15T12:12:00+0800" }`, the same session and the same
 * re-authenticate-once-on-401 recovery as the two POS writes in
 * `plus-import.ts`. The write sets an absolute value, so re-sending it after
 * a timeout converges on the same state; that is what makes the retry safe
 * on a PATCH.
 *
 * Never throws for a POS failure. The caller records the failure on the
 * extension row and the payment stands regardless.
 */

import { httpFetch, redactUrlForLogs } from "./http.ts"
import type { HttpAttemptOutcome } from "./http.ts"
import { createLogger } from "./logger.ts"
import { resolvePosOutletValidUntilUrl } from "./pos-api.ts"
import type { PosSessionHolder } from "./pos-session.ts"
import { formatPosValidUntil } from "./renewal/extension.ts"

const log = createLogger("pos-valid-until")

const TIMEOUT_MS = 15_000

const RETRY_ABSOLUTE_WRITE = (outcome: HttpAttemptOutcome): boolean => {
  if (outcome.kind === "error") {
    return true
  }
  return [429, 502, 503, 504].includes(outcome.response.status)
}

export type PushValidUntilInput = {
  franchiseId: string
  outletId: string
  /** The new expiry as stored (UTC DATETIME). Formatted for the POS here. */
  validUntil: string
}

export type PushValidUntilOutcome =
  | { ok: true; sent: string }
  | { ok: false; message: string; status: number | null }

export async function pushValidUntilToPos(
  input: PushValidUntilInput,
  session: PosSessionHolder,
  fetchImpl?: typeof fetch
): Promise<PushValidUntilOutcome> {
  const url = resolvePosOutletValidUntilUrl(input.franchiseId, input.outletId)
  const sent = formatPosValidUntil(input.validUntil)
  const body = JSON.stringify({ valid_until: sent })

  const send = (token: string, label: string, attempts: number) =>
    httpFetch(
      url,
      {
        method: "PATCH",
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body,
        label,
        timeoutMs: TIMEOUT_MS,
        attempts,
        shouldRetry: RETRY_ABSOLUTE_WRITE,
      },
      fetchImpl
    )

  try {
    const current = await session.get()
    let response = await send(current.token, "pos.validUntil", 2)

    if (response.status === 401) {
      const refreshed = await session.refresh()
      response = await send(refreshed.token, "pos.validUntil.reauth", 1)
    }

    if (!response.ok) {
      const details = (await response.text().catch(() => "")).slice(0, 300)
      const message = details
        ? `POS returned ${response.status}: ${details}`
        : `POS returned ${response.status}.`
      log.warn("valid_until push refused", {
        url: redactUrlForLogs(url),
        status: response.status,
        franchiseId: input.franchiseId,
        outletId: input.outletId,
      })
      return { ok: false, message, status: response.status }
    }

    return { ok: true, sent }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    log.error("valid_until push failed", error, {
      url: redactUrlForLogs(url),
      franchiseId: input.franchiseId,
      outletId: input.outletId,
    })
    return { ok: false, message: message.slice(0, 500), status: null }
  }
}
