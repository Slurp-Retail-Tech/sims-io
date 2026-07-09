import { createHash } from "node:crypto"

import { normalizeWhatsappNumber } from "./whatsapp.ts"

/**
 * Meta Conversions API (server-side pixel). Sends the demoform `Lead`
 * conversion directly to Meta so conversions are captured even when the
 * browser pixel is blocked by an ad blocker. Fires alongside the browser pixel
 * and is deduplicated by Meta via a shared `event_id` (the same id is passed to
 * `fbq('track','Lead', …, { eventID })` on the client).
 *
 * Best-effort: `sendLeadConversion` never throws; a failure is logged and the
 * lead flow continues. No-op unless both a pixel id and access token are set.
 */

const GRAPH_VERSION = "v21.0"

export type LeadConversionInput = {
  /** Shared dedup id — must match the browser pixel's eventID. */
  eventId: string | null
  /** URL of the page where the conversion happened (the demoform). */
  eventSourceUrl: string | null
  clientIpAddress: string | null
  clientUserAgent: string | null
  telephone: string
  name: string | null
  /** `_fbc` cookie value, if the browser pixel set one. */
  fbc: string | null
  /** `_fbp` cookie value, if the browser pixel set one. */
  fbp: string | null
  /** Facebook click id from the landing URL, used to synthesise `fbc`. */
  fbclid: string | null
  source: string | null
  businessType: string | null
  language: string | null
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex")
}

/** SHA-256 of a trimmed, lower-cased value, per Meta's hashing rules. */
export function hashNormalized(value: string | null): string | null {
  if (!value) {
    return null
  }
  const normalized = value.trim().toLowerCase()
  return normalized ? sha256(normalized) : null
}

/** Phone is normalised to country-coded digits before hashing. */
export function hashPhone(telephone: string): string | null {
  const number = normalizeWhatsappNumber(telephone)
  return number ? sha256(number) : null
}

/**
 * Reuses the `_fbc` cookie when present; otherwise synthesises the click id in
 * Meta's `fb.1.<unix_ms>.<fbclid>` format so click attribution still matches.
 */
export function deriveFbc(
  fbcCookie: string | null,
  fbclid: string | null,
  eventTimeMs: number
): string | null {
  if (fbcCookie) {
    return fbcCookie
  }
  return fbclid ? `fb.1.${eventTimeMs}.${fbclid}` : null
}

/**
 * Builds the single CAPI event object (hashed user data + custom data). Pure
 * and deterministic given `eventTimeMs`, so it can be unit-tested.
 */
export function buildLeadEvent(input: LeadConversionInput, eventTimeMs: number) {
  const userData: Record<string, unknown> = {}

  const ph = hashPhone(input.telephone)
  if (ph) {
    userData.ph = [ph]
  }

  if (input.name) {
    const [first, ...rest] = input.name.trim().split(/\s+/)
    const fn = hashNormalized(first)
    if (fn) {
      userData.fn = [fn]
    }
    const ln = hashNormalized(rest.join(" "))
    if (ln) {
      userData.ln = [ln]
    }
  }

  if (input.clientIpAddress) {
    userData.client_ip_address = input.clientIpAddress
  }
  if (input.clientUserAgent) {
    userData.client_user_agent = input.clientUserAgent
  }
  const fbc = deriveFbc(input.fbc, input.fbclid, eventTimeMs)
  if (fbc) {
    userData.fbc = fbc
  }
  if (input.fbp) {
    userData.fbp = input.fbp
  }

  const customData: Record<string, unknown> = {}
  if (input.source) {
    customData.source = input.source
  }
  if (input.businessType) {
    customData.business_type = input.businessType
  }
  if (input.language) {
    customData.language = input.language
  }

  const event: Record<string, unknown> = {
    event_name: "Lead",
    event_time: Math.floor(eventTimeMs / 1000),
    action_source: "website",
    user_data: userData,
  }
  if (input.eventId) {
    event.event_id = input.eventId
  }
  if (input.eventSourceUrl) {
    event.event_source_url = input.eventSourceUrl
  }
  if (Object.keys(customData).length > 0) {
    event.custom_data = customData
  }

  return event
}

export async function sendLeadConversion(
  input: LeadConversionInput
): Promise<{ sent: boolean; reason?: string }> {
  const pixelId = process.env.NEXT_PUBLIC_META_PIXEL_ID?.trim()
  const accessToken = process.env.META_CAPI_ACCESS_TOKEN?.trim()
  if (!pixelId || !accessToken) {
    return { sent: false, reason: "not-configured" }
  }

  const event = buildLeadEvent(input, Date.now())
  const body: Record<string, unknown> = { data: [event] }
  const testEventCode = process.env.META_CAPI_TEST_EVENT_CODE?.trim()
  if (testEventCode) {
    body.test_event_code = testEventCode
  }

  const url = `https://graph.facebook.com/${GRAPH_VERSION}/${pixelId}/events?access_token=${encodeURIComponent(
    accessToken
  )}`

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 5000)
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    })
    if (!response.ok) {
      const text = await response.text().catch(() => "")
      console.error("Meta CAPI Lead event failed", response.status, text)
      return { sent: false, reason: `http-${response.status}` }
    }
    return { sent: true }
  } catch (error) {
    console.error("Meta CAPI Lead event error", error)
    return { sent: false, reason: "error" }
  } finally {
    clearTimeout(timeout)
  }
}
