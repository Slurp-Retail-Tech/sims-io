import { NextRequest, NextResponse } from "next/server"

import { errorResponse, tooManyRequests } from "@/lib/api-errors"
import { getAuthenticatedUser } from "@/lib/auth"
import { checkRateLimit, getRateLimitIp } from "@/lib/rate-limit"
import { hashClientIp } from "@/lib/renewal/public-invoice"
import {
  buildPublicView,
  loadPublicInvoice,
} from "@/lib/renewal/public-invoice"
import type {
  LoadedPublicInvoice,
  PublicInvoiceView,
  PublicPaymentState,
} from "@/lib/renewal/public-invoice"
import { isRenewalTokenShape } from "@/lib/renewal/public-invoice-rules"
import { findLatestSession, findLiveSession } from "@/lib/renewal/payment-sessions"
import type { PaymentSessionRecord } from "@/lib/renewal/payment-sessions"

/**
 * The public renewal routes share one entry: rate limit, validate the token's
 * shape before any database work, load the invoice, and note whether the
 * caller is signed-in staff (whose visits must not count as merchant opens).
 *
 * Two rate-limit buckets, as the CSAT link does: one by IP so enumeration
 * across links is throttled, one by a truncated hash of the token so a single
 * link cannot be hammered and an attacker-controlled value never becomes an
 * unbounded Redis key.
 */
export type PublicAction = "read" | "mutate" | "pay"

const LIMITS: Record<PublicAction, { ip: number; token: number }> = {
  read: { ip: 90, token: 40 },
  mutate: { ip: 30, token: 15 },
  pay: { ip: 15, token: 6 },
}
const WINDOW_SECONDS = 300

export const INVALID_LINK = "This renewal link is not valid."

export type PublicRequestContext = {
  loaded: LoadedPublicInvoice
  ip: string
  userAgent: string | null
  isStaff: boolean
}

export async function guardPublicRequest(
  request: NextRequest,
  token: string,
  action: PublicAction
): Promise<{ ok: true; context: PublicRequestContext } | { ok: false; response: NextResponse }> {
  if (!isRenewalTokenShape(token)) {
    return { ok: false, response: errorResponse(INVALID_LINK, 404) }
  }

  const ip = getRateLimitIp(request)
  const tokenBucket = hashClientIp(token).slice(0, 16)
  const limits = LIMITS[action]
  const [byIp, byToken] = await Promise.all([
    checkRateLimit(`renew:${action}:ip:${ip}`, limits.ip, WINDOW_SECONDS),
    checkRateLimit(`renew:${action}:token:${tokenBucket}`, limits.token, WINDOW_SECONDS),
  ])
  const limited = !byIp.allowed ? byIp : !byToken.allowed ? byToken : null
  if (limited && !limited.allowed) {
    return { ok: false, response: tooManyRequests(limited.retryAfterSeconds) }
  }

  const loaded = await loadPublicInvoice(token)
  if (!loaded) {
    return { ok: false, response: errorResponse(INVALID_LINK, 404) }
  }

  const isStaff = Boolean(await getAuthenticatedUser(request))

  return {
    ok: true,
    context: {
      loaded,
      ip,
      userAgent: request.headers.get("user-agent"),
      isStaff,
    },
  }
}

/** The payment block of the view, from the latest session. */
export async function paymentStateFor(
  loaded: LoadedPublicInvoice
): Promise<{ state: PublicPaymentState; live: PaymentSessionRecord | null }> {
  const { invoice } = loaded
  if (invoice.status === "paid") {
    return {
      state: { state: "paid", redirectUrl: null, expiresAt: null, paidAt: invoice.paidAt },
      live: null,
    }
  }

  const live = await findLiveSession(invoice.id)
  if (live && live.redirectUrl) {
    return {
      state: {
        state: "pending",
        redirectUrl: live.redirectUrl,
        expiresAt: live.expiresAt,
        paidAt: null,
      },
      live,
    }
  }

  const latest = await findLatestSession(invoice.id)
  if (latest && (latest.status === "failed" || latest.status === "expired")) {
    return {
      state: { state: latest.status, redirectUrl: null, expiresAt: null, paidAt: null },
      live: null,
    }
  }

  return { state: { state: "none", redirectUrl: null, expiresAt: null, paidAt: null }, live: null }
}

export async function viewFor(loaded: LoadedPublicInvoice): Promise<PublicInvoiceView> {
  const { state } = await paymentStateFor(loaded)
  return buildPublicView(loaded, state)
}

/** The origin merchants are sent back to. */
export function publicBaseUrl(request: NextRequest): string {
  const configured = process.env.APP_BASE_URL?.trim()
  return (configured || new URL(request.url).origin).replace(/\/+$/, "")
}
