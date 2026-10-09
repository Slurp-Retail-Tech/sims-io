import { NextRequest, NextResponse } from "next/server"

import { resolveApiUser } from "@/lib/api-auth"
import { forbidden, notFound, serverError } from "@/lib/api-errors"
import { withRequestContext } from "@/lib/api-request-context"
import {
  evaluateDesignationAccess,
  SUBSCRIPTIONS_MANAGE_PATH,
} from "@/lib/renewal/designation-access"
import { setRenewalDesignation } from "@/lib/renewal/renewal-contacts"

import { parseContactId } from "../../../../helpers"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

type RouteContext = {
  params: Promise<{ contactId: string; mappingId: string }>
}

/**
 * PATCH — designate a mapping as renewal PIC, CC, both, or neither.
 *
 * Needs the Contacts key AND the renewal subscriptions key: deciding who a
 * merchant's renewal is addressed to is a renewal decision that happens to be
 * recorded on a contact. Somebody who may edit the contact directory is not
 * thereby entitled to redirect an invoice.
 *
 * Refuses when another contact already holds the PIC slot for the same
 * franchise-and-outlet scope, naming them, because "someone else is already
 * the PIC" is unactionable without knowing who.
 */
export const PATCH = withRequestContext(
  "/api/contacts/[contactId]/mappings/[mappingId]/renewal",
  handlePatch as never
)

async function handlePatch(
  request: NextRequest,
  context: RouteContext
): Promise<Response> {
  const auth = await resolveApiUser(request, {
    allowedPaths: [SUBSCRIPTIONS_MANAGE_PATH],
  })
  if ("response" in auth) {
    return auth.response
  }

  // `allowedPaths` is an OR. The Contacts gate is a second, independent check
  // so both keys are genuinely required; see designation-access.ts.
  const gate = evaluateDesignationAccess(auth.user)
  if (!gate.allowed) {
    return forbidden(
      "Changing a renewal designation needs access to Contacts as well."
    )
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 })
  }

  const isRenewalPic = Boolean((body as { isRenewalPic?: unknown }).isRenewalPic)
  const isRenewalCc = Boolean((body as { isRenewalCc?: unknown }).isRenewalCc)

  try {
    const { contactId, mappingId } = await context.params
    if (!parseContactId(contactId) || !parseContactId(mappingId)) {
      return notFound("Mapping not found.")
    }

    const result = await setRenewalDesignation(mappingId, {
      isRenewalPic,
      isRenewalCc,
    })

    if (result.ok) {
      return NextResponse.json({ mappingId, isRenewalPic, isRenewalCc })
    }

    if (result.reason === "mapping_not_found") {
      return notFound("Mapping not found.")
    }

    return NextResponse.json(
      {
        error: `${result.existingContactName} is already the renewal PIC for this scope. Remove that designation first.`,
        existingContactId: result.existingContactId,
      },
      { status: 409 }
    )
  } catch (error) {
    return serverError(
      "contacts/[contactId]/mappings/[mappingId]/renewal",
      error,
      "Unable to save the designation."
    )
  }
}
