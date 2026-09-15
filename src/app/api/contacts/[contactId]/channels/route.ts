import { NextRequest, NextResponse } from "next/server"

import { notFound, serverError } from "@/lib/api-errors"
import { withRequestContext } from "@/lib/api-request-context"
import {
  loadContactChannels,
  setContactChannels,
} from "@/lib/renewal/renewal-contacts"

import { parseContactId, resolveContactsUser } from "../../helpers"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

type RouteContext = { params: Promise<{ contactId: string }> }

const CHANNELS = ["whatsapp", "email"] as const

/** GET — which channels this contact is reachable on. */
export const GET = withRequestContext(
  "/api/contacts/[contactId]/channels",
  handleGet as never
)

async function handleGet(
  request: NextRequest,
  context: RouteContext
): Promise<Response> {
  const auth = await resolveContactsUser(request)
  if ("response" in auth) {
    return auth.response
  }

  try {
    const { contactId } = await context.params
    const parsed = parseContactId(contactId)
    if (!parsed) {
      return notFound("Contact not found.")
    }
    return NextResponse.json({
      channels: await loadContactChannels(String(parsed)),
    })
  } catch (error) {
    return serverError(
      "contacts/[contactId]/channels",
      error,
      "Unable to load channels."
    )
  }
}

/**
 * PUT — replace the channel list.
 *
 * A whole list rather than a patch, because "which channels does this person
 * use" is one answer, and a partial update leaves the reader guessing whether
 * an absent channel is disabled or merely unmentioned. A renewal message goes
 * to every enabled channel, so the distinction matters.
 */
export const PUT = withRequestContext(
  "/api/contacts/[contactId]/channels",
  handlePut as never
)

async function handlePut(
  request: NextRequest,
  context: RouteContext
): Promise<Response> {
  const auth = await resolveContactsUser(request)
  if ("response" in auth) {
    return auth.response
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 })
  }

  const raw = (body as { channels?: unknown }).channels
  if (!Array.isArray(raw)) {
    return NextResponse.json(
      { error: "Send a channels array." },
      { status: 422 }
    )
  }

  const seen = new Set<string>()
  const channels: Array<{ channel: "whatsapp" | "email"; isEnabled: boolean }> = []

  for (const entry of raw) {
    const channel = (entry as { channel?: unknown }).channel
    if (typeof channel !== "string" || !CHANNELS.includes(channel as never)) {
      return NextResponse.json(
        { error: `Channel must be one of: ${CHANNELS.join(", ")}.` },
        { status: 422 }
      )
    }
    if (seen.has(channel)) {
      return NextResponse.json(
        { error: `Channel ${channel} was listed twice.` },
        { status: 422 }
      )
    }
    seen.add(channel)
    channels.push({
      channel: channel as "whatsapp" | "email",
      isEnabled: Boolean((entry as { isEnabled?: unknown }).isEnabled),
    })
  }

  try {
    const { contactId } = await context.params
    const parsed = parseContactId(contactId)
    if (!parsed) {
      return notFound("Contact not found.")
    }

    await setContactChannels(String(parsed), channels)
    return NextResponse.json({
      channels: await loadContactChannels(String(parsed)),
    })
  } catch (error) {
    return serverError(
      "contacts/[contactId]/channels",
      error,
      "Unable to save channels."
    )
  }
}
