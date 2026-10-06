import type { ResultSetHeader, RowDataPacket } from "mysql2/promise"
import { NextRequest, NextResponse } from "next/server"

import { loadContactMappings, withContactLock, withTransaction } from "@/app/api/contacts/helpers"
import { resolveApiUser } from "@/lib/api-auth"
import { queryWithReconnect } from "@/lib/db"
import { forbidden, serverError } from "@/lib/api-errors"
import { withRequestContext } from "@/lib/api-request-context"
import { findDuplicateContacts, validateContactInput } from "@/lib/contacts"
import { evaluateDesignationAccess, SUBSCRIPTIONS_MANAGE_PATH } from "@/lib/renewal/designation-access"
import { buildPicCandidates } from "@/lib/renewal/pic-candidates"
import { decidePicMapping } from "@/lib/renewal/pic-mapping"
import { loadRenewalDirectory, setContactChannels, setRenewalDesignation } from "@/lib/renewal/renewal-contacts"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

/**
 * GET /api/renewals/pic-candidates?fid=&oid= — who could be made renewal PIC
 * for an outlet (or, without `oid`, for a whole franchise), with whether each
 * can actually be reached.
 *
 * Gated like the designation it feeds: the renewal subscriptions key AND
 * Contacts, so nobody sees a list they could not act on.
 */
export const GET = withRequestContext("/api/renewals/pic-candidates", handleGet)

async function handleGet(request: NextRequest): Promise<Response> {
  const auth = await resolveApiUser(request, { allowedPaths: [SUBSCRIPTIONS_MANAGE_PATH] })
  if ("response" in auth) {
    return auth.response
  }
  if (!evaluateDesignationAccess(auth.user).allowed) {
    return forbidden("Setting a renewal PIC needs access to Contacts as well.")
  }

  const { searchParams } = new URL(request.url)
  const franchiseId = searchParams.get("fid")?.trim() ?? ""
  const outletId = searchParams.get("oid")?.trim() || null
  if (!franchiseId) {
    return NextResponse.json({ error: "Give the franchise id." }, { status: 400 })
  }

  try {
    const directory = await loadRenewalDirectory(franchiseId)
    return NextResponse.json({ candidates: buildPicCandidates(directory, outletId) })
  } catch (error) {
    return serverError("renewals/pic-candidates", error, "Unable to load the contacts.")
  }
}

/**
 * POST /api/renewals/pic-candidates — make someone the renewal PIC who is not
 * yet mapped here, from the Actions Required panel: a brand-new contact, or an
 * existing one found by the duplicate check.
 *
 * Body: `{ franchiseId, outletId, scope: "outlet" | "franchise", contact?:
 * { name, email, role, phones, channels: { email, whatsapp } },
 * existingContactId? }`.
 *
 * Runs the same rules as the Contacts page, in the same order: the duplicate
 * check and insert in one transaction (a match returns 409 with the matches,
 * so the panel can offer to use that person instead), the mapping under the
 * contact lock with the overlap rules, then the PIC designation under its
 * single-PIC lock. A step that refuses leaves the earlier ones in place and
 * says so: the contact is real and can be designated later.
 */
export const POST = withRequestContext("/api/renewals/pic-candidates", handlePost)

type NewContactBody = {
  name?: unknown
  email?: unknown
  role?: unknown
  phones?: unknown
  channels?: { email?: unknown; whatsapp?: unknown }
}

async function handlePost(request: NextRequest): Promise<Response> {
  const auth = await resolveApiUser(request, { allowedPaths: [SUBSCRIPTIONS_MANAGE_PATH] })
  if ("response" in auth) {
    return auth.response
  }
  if (!evaluateDesignationAccess(auth.user).allowed) {
    return forbidden("Setting a renewal PIC needs access to Contacts as well.")
  }

  const body = (await request.json().catch(() => null)) as {
    franchiseId?: unknown
    outletId?: unknown
    scope?: unknown
    contact?: NewContactBody
    existingContactId?: unknown
  } | null
  const franchiseId = typeof body?.franchiseId === "string" ? body.franchiseId.trim() : ""
  const entryOutletId = typeof body?.outletId === "string" && body.outletId.trim() ? body.outletId.trim() : null
  if (!franchiseId) {
    return NextResponse.json({ error: "Give the franchise id." }, { status: 400 })
  }
  // A franchise-level gap can only be fixed at franchise scope.
  const targetOutletId = body?.scope === "franchise" || entryOutletId === null ? null : entryOutletId

  try {
    // 1. The contact: an existing one, or a new one through the duplicate check.
    let contactId: string
    let contactName: string
    let created = false
    if (typeof body?.existingContactId === "string" && /^\d+$/.test(body.existingContactId)) {
      const [rows] = await queryWithReconnect<Array<RowDataPacket & { id: number; name: string }>>(
        `SELECT id, name FROM contacts WHERE id = ? AND deleted_at IS NULL LIMIT 1`,
        [body.existingContactId]
      )
      if (!rows[0]) {
        return NextResponse.json({ error: "That contact no longer exists." }, { status: 404 })
      }
      contactId = String(rows[0].id)
      contactName = rows[0].name
    } else {
      const raw = body?.contact ?? {}
      const validation = validateContactInput({
        name: typeof raw.name === "string" ? raw.name : "",
        email: typeof raw.email === "string" ? raw.email : "",
        role: typeof raw.role === "string" && raw.role.trim() ? raw.role : null,
        phones: Array.isArray(raw.phones) ? raw.phones.filter((entry): entry is string => typeof entry === "string") : [],
      })
      if (!validation.value) {
        return NextResponse.json(
          { error: "Please correct the highlighted fields.", errors: validation.errors },
          { status: 400 }
        )
      }
      const input = validation.value
      const outcome = await withTransaction(async (connection) => {
        const matches = await findDuplicateContacts(connection, {
          email: input.email,
          phonesNormalized: input.phones.map((phone) => phone.phoneNormalized),
        })
        if (matches.length) {
          return { matches }
        }
        const [result] = await connection.query<ResultSetHeader>(
          `INSERT INTO contacts (name, email, role, source, created_by_user_id) VALUES (?, ?, ?, 'staff', ?)`,
          [input.name, input.email, input.role, auth.user.id]
        )
        await connection.query(
          `INSERT INTO contact_phone_numbers (contact_id, phone, phone_normalized, is_primary)
           VALUES ${input.phones.map(() => "(?, ?, ?, ?)").join(", ")}`,
          input.phones.flatMap((phone) => [result.insertId, phone.phone, phone.phoneNormalized, phone.isPrimary ? 1 : 0])
        )
        return { contactId: String(result.insertId) }
      })
      if ("matches" in outcome) {
        return NextResponse.json(
          {
            error: "This person is already in Contacts. Use them instead of creating a duplicate.",
            matches: outcome.matches,
          },
          { status: 409 }
        )
      }
      contactId = outcome.contactId
      contactName = input.name
      created = true

      // Their channels, as chosen in the panel. Only for a new contact: an
      // existing one's channels are theirs to manage on the contact page.
      const channels = raw.channels ?? {}
      await setContactChannels(contactId, [
        { channel: "email", isEnabled: channels.email !== false },
        { channel: "whatsapp", isEnabled: channels.whatsapp !== false },
      ])
    }

    // 2. The mapping: reuse one that covers the target, or add one.
    const mapping = await withContactLock(contactId, async (connection) => {
      const decision = decidePicMapping(await loadContactMappings(contactId, connection), {
        franchiseId,
        outletId: targetOutletId,
      })
      if (decision.kind !== "add") {
        return decision
      }
      const [result] = await connection.query<ResultSetHeader>(
        `INSERT INTO contact_outlets (contact_id, franchise_id, outlet_id, created_by_user_id) VALUES (?, ?, ?, ?)`,
        [contactId, franchiseId, targetOutletId, auth.user.id]
      )
      return { kind: "reuse" as const, mappingId: String(result.insertId), scope: decision.scope, isRenewalCc: false }
    })
    if (mapping.kind === "refuse") {
      return NextResponse.json(
        { error: created ? `${contactName} was added to Contacts, but: ${mapping.message}` : mapping.message, contactId },
        { status: 409 }
      )
    }

    // 3. The designation, under the single-PIC rule.
    const designated = await setRenewalDesignation(mapping.mappingId, { isRenewalPic: true, isRenewalCc: mapping.isRenewalCc })
    if (!designated.ok) {
      const reason =
        designated.reason === "pic_taken"
          ? `${designated.existingContactName} is already the renewal PIC for this scope.`
          : "The mapping could not be found."
      return NextResponse.json(
        { error: created ? `${contactName} was added to Contacts and mapped here, but ${reason}` : reason, contactId },
        { status: 409 }
      )
    }

    return NextResponse.json(
      { contactId, contactName, mappingId: mapping.mappingId, scope: mapping.scope, created },
      { status: created ? 201 : 200 }
    )
  } catch (error) {
    return serverError("renewals/pic-candidates", error, "Unable to set the renewal PIC.")
  }
}
