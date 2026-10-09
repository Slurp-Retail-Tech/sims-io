import { after, NextRequest, NextResponse } from "next/server"

import { errorResponse, serverError, tooManyRequests } from "@/lib/api-errors"
import { withRequestContext } from "@/lib/api-request-context"
import { readCommercePayConfig } from "@/lib/commercepay/client"
import { verifyCallbackSignature } from "@/lib/commercepay/signature"
import type { SignableBody } from "@/lib/commercepay/signature"
import { RENEWAL_POST_PAYMENT_JOB_TYPE } from "@/lib/job-types"
import { driveJobType } from "@/lib/job-tick"
import { createLogger } from "@/lib/logger"
import { checkRateLimit, getRateLimitIp } from "@/lib/rate-limit"
import {
  CALLBACK_PATH,
  finishCallbackRecord,
  recordCallback,
} from "@/lib/renewal/payment-callbacks"
import { processGatewayNotice } from "@/lib/renewal/payment-confirmation"
import { parseGatewayNotice } from "@/lib/renewal/payment-confirmation-rules"
import { findSessionCallbackUrl } from "@/lib/renewal/payment-sessions"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

const log = createLogger("commercepay:callback")

/** Generous: the gateway retries, and a merchant paying is one call. */
const RATE_LIMIT = { max: 120, windowSeconds: 300 }

/**
 * POST — CommercePay's host-to-host payment notification.
 *
 * Order of operations, deliberately:
 *
 *  1. Persist the raw body before parsing or verifying anything. A disputed
 *     payment is replayed from what the gateway actually sent, not from what
 *     SIMS made of it.
 *  2. Verify `cap-signature` over the callback URL the session was opened
 *     with. A mismatch is 401 and nothing downstream runs.
 *  3. Apply the notice. Idempotent: a replay is recorded as a duplicate.
 *  4. Respond 200 at once, and drive the post-payment job after the response
 *     so the merchant on the receipt page sees the documents without waiting
 *     for the next scheduler tick.
 */
export const POST = withRequestContext(CALLBACK_PATH, handlePost)

async function handlePost(request: NextRequest): Promise<Response> {
  const ip = getRateLimitIp(request)
  const limit = await checkRateLimit(`commercepay:callback:${ip}`, RATE_LIMIT.max, RATE_LIMIT.windowSeconds)
  if (!limit.allowed) {
    return tooManyRequests(limit.retryAfterSeconds)
  }

  const rawBody = await request.text()
  const presentedSignature = request.headers.get("cap-signature")

  let parsed: unknown = null
  try {
    parsed = rawBody ? (JSON.parse(rawBody) as unknown) : null
  } catch {
    parsed = null
  }
  const notice = parseGatewayNotice(parsed)

  let callbackId: string | null = null
  try {
    callbackId = await recordCallback({ rawBody, presentedSignature, notice })
  } catch (error) {
    // Without the evidence row nothing else should proceed.
    return serverError("public/commercepay/callback", error, "Callback could not be recorded.")
  }

  const config = readCommercePayConfig()
  if (!config) {
    await finishCallbackRecord(callbackId, { outcome: "error", note: "CommercePay is not configured", signatureValid: false })
    return errorResponse("Payment gateway is not configured.", 503)
  }

  if (!notice || !parsed || typeof parsed !== "object") {
    await finishCallbackRecord(callbackId, { outcome: "unmatched", note: "Body was not a recognisable callback", signatureValid: false })
    return errorResponse("Unrecognised callback body.", 400)
  }

  // The URL the gateway signed is the one the session was opened with.
  const callbackUrl =
    (await findSessionCallbackUrl(notice.referenceCode)) ?? `${configuredBaseUrl(request)}${CALLBACK_PATH}`
  const valid = verifyCallbackSignature({
    callbackUrl,
    body: parsed as SignableBody,
    presentedSignature,
    secretKey: config.secretKey,
  })
  if (!valid) {
    log.warn("Callback signature rejected", { referenceCode: notice.referenceCode, ip })
    await finishCallbackRecord(callbackId, { outcome: "rejected_signature", note: null, signatureValid: false })
    return errorResponse("Invalid signature.", 401)
  }

  try {
    const result = await processGatewayNotice(notice, "callback")
    await finishCallbackRecord(callbackId, {
      outcome: result.outcome,
      note: result.note,
      signatureValid: true,
      sessionId: result.sessionId,
    })

    if (result.outcome === "accepted") {
      after(async () => {
        try {
          await driveJobType(RENEWAL_POST_PAYMENT_JOB_TYPE)
        } catch (error) {
          log.error("Post-payment drive after callback failed; the tick will pick it up", error)
        }
      })
    }

    return NextResponse.json({ received: true, outcome: result.outcome }, { status: 200 })
  } catch (error) {
    await finishCallbackRecord(callbackId, {
      outcome: "error",
      note: error instanceof Error ? error.message.slice(0, 500) : "Processing failed",
      signatureValid: true,
    })
    return serverError("public/commercepay/callback", error, "Callback could not be processed.")
  }
}

function configuredBaseUrl(request: NextRequest): string {
  const configured = process.env.APP_BASE_URL?.trim()
  return (configured || new URL(request.url).origin).replace(/\/+$/, "")
}
