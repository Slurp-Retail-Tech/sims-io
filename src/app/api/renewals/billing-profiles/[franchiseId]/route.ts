import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"

import { resolveApiUser } from "@/lib/api-auth"
import { errorResponse, notFound, serverError } from "@/lib/api-errors"
import { withRequestContext } from "@/lib/api-request-context"
import {
  confirmProfile,
  deleteBillingProfile,
  linkBukkuContact,
  saveManualProfile,
} from "@/lib/renewal/billing-profiles"

import { BILLING_PROFILES_MANAGE_PATH } from "../helpers"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

type RouteContext = { params: Promise<{ franchiseId: string }> }

const FRANCHISE_ID = /^[A-Za-z0-9_-]{1,120}$/

const optional = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((value) => (value ? value : null))

const bodySchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("link"), contactCode: z.string().trim().min(1).max(64) }),
  z.object({ action: z.literal("confirm") }),
  z.object({
    action: z.literal("manual"),
    bukkuContactCode: optional(64),
    legalName: z.string().trim().min(1, "Enter the registered company name.").max(255),
    regNoType: z.enum(["BRN", "NRIC", "PASSPORT"]).nullish().transform((value) => value ?? null),
    registrationNo: optional(120),
    oldRegistrationNo: optional(120),
    tin: optional(64),
    sstNo: optional(64),
    street: optional(1000),
    city: optional(120),
    state: optional(120),
    postcode: optional(16),
    country: optional(8),
  }),
])

/**
 * PUT — set a franchise's billing profile: link it to an imported Bukku
 * contact, confirm the importer's match, or save details typed in by hand.
 * Open proformas pick up the change. Needs the manage key.
 */
export const PUT = withRequestContext("/api/renewals/billing-profiles/[franchiseId]", handlePut as never)

async function handlePut(request: NextRequest, context: RouteContext): Promise<Response> {
  const auth = await resolveApiUser(request, { allowedPaths: [BILLING_PROFILES_MANAGE_PATH] })
  if ("response" in auth) {
    return auth.response
  }
  const { franchiseId } = await context.params
  if (!FRANCHISE_ID.test(franchiseId)) {
    return notFound("Franchise not found.")
  }

  let raw: unknown
  try {
    raw = await request.json()
  } catch {
    return errorResponse("Invalid JSON body.", 400)
  }
  const parsed = bodySchema.safeParse(raw)
  if (!parsed.success) {
    return errorResponse(parsed.error.issues[0]?.message ?? "Invalid request.", 400)
  }

  try {
    const body = parsed.data
    const outcome =
      body.action === "link"
        ? await linkBukkuContact(franchiseId, body.contactCode, auth.user.id)
        : body.action === "confirm"
          ? await confirmProfile(franchiseId, auth.user.id)
          : await saveManualProfile(franchiseId, body, auth.user.id)
    if (!outcome.ok) {
      return errorResponse(outcome.message, outcome.status)
    }
    return NextResponse.json({ profile: outcome.profile, documentsRefreshed: outcome.documentsRefreshed })
  } catch (error) {
    return serverError("renewals/billing-profiles/[franchiseId]", error, "Unable to save the billing profile.")
  }
}

/** DELETE — remove the profile; open proformas go back to the company name alone. */
export const DELETE = withRequestContext("/api/renewals/billing-profiles/[franchiseId]", handleDelete as never)

async function handleDelete(request: NextRequest, context: RouteContext): Promise<Response> {
  const auth = await resolveApiUser(request, { allowedPaths: [BILLING_PROFILES_MANAGE_PATH] })
  if ("response" in auth) {
    return auth.response
  }
  const { franchiseId } = await context.params
  if (!FRANCHISE_ID.test(franchiseId)) {
    return notFound("Franchise not found.")
  }
  try {
    const documentsRefreshed = await deleteBillingProfile(franchiseId)
    return NextResponse.json({ documentsRefreshed })
  } catch (error) {
    return serverError("renewals/billing-profiles/[franchiseId]", error, "Unable to remove the billing profile.")
  }
}
