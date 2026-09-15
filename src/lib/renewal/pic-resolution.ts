/**
 * Who a renewal is addressed to, and which channels actually reach them.
 *
 * Mirrors plan resolution deliberately: outlet-specific first, then
 * franchise-wide, then nobody. The same two-scope shape the Contacts module
 * already uses, where `outlet_id` NULL on a mapping means "every outlet under
 * this franchise".
 *
 * Three rules here are load-bearing and easy to get wrong:
 *
 *  1. **A CC is never promoted to PIC.** An outlet with copied-in contacts and
 *     nobody designated is still blocked, because nobody has been made
 *     accountable for the renewal. Quietly addressing the reminder to whoever
 *     happens to be on the list is how a renewal ends up chased by no one.
 *
 *  2. **Channels do not substitute for each other.** A contact who wants both
 *     WhatsApp and email enables both, and every message goes to every enabled
 *     channel. A failure on one is retried on that one. Nothing is ever
 *     rerouted onto a channel the contact did not enable.
 *
 *  3. **Partly reachable is not unreachable.** A PIC with both channels
 *     enabled but no phone number still gets the email; the missing channel is
 *     reported as informational rather than blocking the invoice. Only a PIC
 *     with no usable channel at all blocks it.
 *
 * Pure and runtime-free so it can be unit-tested under `node --test`. The
 * country code is a parameter rather than an environment read for the same
 * reason.
 */

export const DEFAULT_COUNTRY_CODE = "60"

export type Channel = "whatsapp" | "email"
export type RecipientRole = "pic" | "cc"

export type ContactChannelState = {
  channel: Channel
  isEnabled: boolean
}

export type RenewalContact = {
  contactId: string
  name: string
  /** `contacts.email` is NOT NULL but may be an empty string. */
  email: string | null
  /** The contact's primary phone, in whatever format it was entered. */
  primaryPhone: string | null
  channels: ContactChannelState[]
}

/** One row of `contact_outlets`, narrowed to what resolution needs. */
export type RenewalMapping = {
  contactId: string
  franchiseId: string
  /** Null means every outlet under the franchise. */
  outletId: string | null
  isRenewalPic: boolean
  isRenewalCc: boolean
}

export type ResolvedChannel = {
  channel: Channel
  /** The Respond.io identifier value: an E.164 number, or an email address. */
  address: string
}

export type ResolvedRecipient = {
  contactId: string
  name: string
  role: RecipientRole
  /** Where the mapping that designated them sits. */
  source: "outlet" | "franchise"
  /** Channels enabled AND holding their supporting field. */
  usable: ResolvedChannel[]
  /** Channels enabled but missing a phone number or an email address. */
  unusable: Channel[]
}

export type PicResolution =
  | {
      status: "resolved"
      pic: ResolvedRecipient
      ccs: ResolvedRecipient[]
    }
  /** Nobody designated. Blocks invoicing. */
  | { status: "no_renewal_pic" }
  /** Designated, but no enabled channel can carry a message. Blocks invoicing. */
  | { status: "unreachable_renewal_pic"; pic: ResolvedRecipient; ccs: ResolvedRecipient[] }

/**
 * Convert a phone number to E.164, the form Respond.io addresses contacts by.
 *
 * A Malaysian number entered locally as `0162207781` is the same subscriber as
 * `+60162207781`, so a leading trunk zero is swapped for the country code.
 * Anything already carrying a `+`, or already starting with the country code,
 * is left alone.
 *
 * Returns null when there are no usable digits, or when the result is too
 * short or too long to be a real number — E.164 allows at most 15 digits, and
 * something under 8 is a typo rather than a phone number.
 */
export function toE164(
  raw: string | null | undefined,
  countryCode: string = DEFAULT_COUNTRY_CODE
): string | null {
  if (!raw) {
    return null
  }

  const trimmed = raw.trim()
  const hadPlus = trimmed.startsWith("+")
  let digits = trimmed.replace(/\D+/g, "")
  if (!digits) {
    return null
  }

  const code = countryCode.replace(/\D+/g, "") || DEFAULT_COUNTRY_CODE

  if (!hadPlus) {
    if (digits.startsWith("0")) {
      digits = `${code}${digits.slice(1)}`
    } else if (!digits.startsWith(code)) {
      digits = `${code}${digits}`
    }
  }

  if (digits.length < 8 || digits.length > 15) {
    return null
  }

  return `+${digits}`
}

/**
 * Whether an address is good enough to send to.
 *
 * Deliberately permissive about the local part and strict about the shape:
 * exactly one `@`, something either side, a dot in the domain, and no
 * whitespace. A full RFC 5322 parser would accept addresses no mail server in
 * this stack would deliver to, and would still not tell us the mailbox exists.
 */
export function isUsableEmail(value: string | null | undefined): boolean {
  if (!value) {
    return false
  }
  const trimmed = value.trim()
  if (!trimmed || /\s/.test(trimmed)) {
    return false
  }
  return /^[^@]+@[^@.]+(\.[^@.]+)+$/.test(trimmed)
}

/**
 * Split a contact's enabled channels into those that can carry a message and
 * those that cannot.
 *
 * A channel that is not enabled appears in neither list: the contact has not
 * asked to be reached that way, so it is not a gap to report.
 */
export function resolveChannels(
  contact: RenewalContact,
  countryCode: string = DEFAULT_COUNTRY_CODE
): { usable: ResolvedChannel[]; unusable: Channel[] } {
  const usable: ResolvedChannel[] = []
  const unusable: Channel[] = []

  for (const state of contact.channels) {
    if (!state.isEnabled) {
      continue
    }

    if (state.channel === "whatsapp") {
      const e164 = toE164(contact.primaryPhone, countryCode)
      if (e164) {
        usable.push({ channel: "whatsapp", address: e164 })
      } else {
        unusable.push("whatsapp")
      }
      continue
    }

    if (isUsableEmail(contact.email)) {
      usable.push({ channel: "email", address: (contact.email as string).trim() })
    } else {
      unusable.push("email")
    }
  }

  return { usable, unusable }
}

/**
 * Resolve the renewal PIC and any CC contacts for one outlet.
 *
 * `mappings` must already be narrowed to the outlet's franchise. Both scopes
 * are considered: a mapping with `outletId` null covers this outlet too.
 *
 * The PIC is the outlet-specific designation where one exists, otherwise the
 * franchise-wide one. CC contacts are the union of both scopes, since copying
 * a franchise head office in on every outlet is the motivating case, and a
 * contact designated CC at both scopes is included once.
 *
 * A contact designated neither PIC nor CC receives nothing, even though they
 * are mapped to the outlet and may well be its main support contact.
 */
export function resolveRenewalPic(
  mappings: readonly RenewalMapping[],
  contacts: ReadonlyMap<string, RenewalContact>,
  outletId: string,
  countryCode: string = DEFAULT_COUNTRY_CODE
): PicResolution {
  const covers = (mapping: RenewalMapping) =>
    mapping.outletId === null || mapping.outletId === outletId

  const relevant = mappings.filter(covers)

  const picMapping =
    relevant.find((mapping) => mapping.isRenewalPic && mapping.outletId === outletId) ??
    relevant.find((mapping) => mapping.isRenewalPic && mapping.outletId === null)

  if (!picMapping) {
    // A CC is never promoted here, deliberately, even when one exists.
    return { status: "no_renewal_pic" }
  }

  const picContact = contacts.get(picMapping.contactId)
  if (!picContact) {
    // Designated against a contact that no longer resolves. Same practical
    // outcome as nobody being designated.
    return { status: "no_renewal_pic" }
  }

  const pic = toRecipient(picContact, "pic", picMapping, countryCode)

  const seen = new Set<string>([picMapping.contactId])
  const ccs: ResolvedRecipient[] = []

  for (const mapping of relevant) {
    if (!mapping.isRenewalCc || seen.has(mapping.contactId)) {
      continue
    }
    const contact = contacts.get(mapping.contactId)
    if (!contact) {
      continue
    }
    seen.add(mapping.contactId)
    ccs.push(toRecipient(contact, "cc", mapping, countryCode))
  }

  if (pic.usable.length === 0) {
    // Nothing can reach the person accountable for this renewal.
    return { status: "unreachable_renewal_pic", pic, ccs }
  }

  return { status: "resolved", pic, ccs }
}

export type GroupPicResolution =
  | { status: "resolved"; pic: ResolvedRecipient; ccs: ResolvedRecipient[] }
  | { status: "no_renewal_pic" }
  | { status: "unreachable_renewal_pic"; pic: ResolvedRecipient; ccs: ResolvedRecipient[] }
  /** Outlets resolve to different PICs and no franchise-wide one exists. */
  | { status: "ambiguous_renewal_pic"; contactIds: string[] }

/**
 * Resolve the single PIC for a grouped franchise invoice.
 *
 * One invoice, one payer, one addressee. Where every outlet in the group
 * already resolves to the same person, that person is it. Where they differ,
 * the franchise-wide PIC is the tie-break, because a franchise-level
 * designation is exactly the statement "this person handles renewals for the
 * whole franchise".
 *
 * Where they differ and there is no franchise-wide PIC, this returns ambiguous
 * rather than picking one. SIMS does not choose which of two accountable
 * people receives an invoice covering outlets that are not all theirs.
 */
export function resolveGroupRenewalPic(
  mappings: readonly RenewalMapping[],
  contacts: ReadonlyMap<string, RenewalContact>,
  outletIds: readonly string[],
  countryCode: string = DEFAULT_COUNTRY_CODE
): GroupPicResolution {
  if (outletIds.length === 0) {
    return { status: "no_renewal_pic" }
  }

  const perOutlet = outletIds.map((outletId) =>
    resolveRenewalPic(mappings, contacts, outletId, countryCode)
  )

  if (perOutlet.every((resolution) => resolution.status === "no_renewal_pic")) {
    return { status: "no_renewal_pic" }
  }

  const picIds = new Set<string>()
  for (const resolution of perOutlet) {
    if (resolution.status === "resolved" || resolution.status === "unreachable_renewal_pic") {
      picIds.add(resolution.pic.contactId)
    }
  }

  if (picIds.size === 0) {
    return { status: "no_renewal_pic" }
  }

  if (picIds.size > 1) {
    const franchiseWide = mappings.find(
      (mapping) => mapping.isRenewalPic && mapping.outletId === null
    )
    const franchiseContact = franchiseWide
      ? contacts.get(franchiseWide.contactId)
      : undefined

    if (!franchiseWide || !franchiseContact) {
      return {
        status: "ambiguous_renewal_pic",
        contactIds: [...picIds].sort(),
      }
    }

    return finish(
      toRecipient(franchiseContact, "pic", franchiseWide, countryCode),
      collectCcs(mappings, contacts, outletIds, franchiseWide.contactId, countryCode)
    )
  }

  // One PIC across the whole group: reuse whichever outlet resolved them, so
  // the source scope is reported honestly.
  const settled = perOutlet.find(
    (resolution) =>
      resolution.status === "resolved" ||
      resolution.status === "unreachable_renewal_pic"
  )
  // `find` above narrows this to the two statuses carrying a `pic`; the guard
  // is for the empty case only.
  if (!settled) {
    return { status: "no_renewal_pic" }
  }

  return finish(
    settled.pic,
    collectCcs(mappings, contacts, outletIds, settled.pic.contactId, countryCode)
  )
}

function finish(
  pic: ResolvedRecipient,
  ccs: ResolvedRecipient[]
): GroupPicResolution {
  if (pic.usable.length === 0) {
    return { status: "unreachable_renewal_pic", pic, ccs }
  }
  return { status: "resolved", pic, ccs }
}

/** Every CC across the group's outlets, each person once. */
function collectCcs(
  mappings: readonly RenewalMapping[],
  contacts: ReadonlyMap<string, RenewalContact>,
  outletIds: readonly string[],
  picContactId: string,
  countryCode: string
): ResolvedRecipient[] {
  const outletSet = new Set(outletIds)
  const seen = new Set<string>([picContactId])
  const ccs: ResolvedRecipient[] = []

  for (const mapping of mappings) {
    if (!mapping.isRenewalCc || seen.has(mapping.contactId)) {
      continue
    }
    if (mapping.outletId !== null && !outletSet.has(mapping.outletId)) {
      continue
    }
    const contact = contacts.get(mapping.contactId)
    if (!contact) {
      continue
    }
    seen.add(mapping.contactId)
    ccs.push(toRecipient(contact, "cc", mapping, countryCode))
  }

  return ccs
}

function toRecipient(
  contact: RenewalContact,
  role: RecipientRole,
  mapping: RenewalMapping,
  countryCode: string
): ResolvedRecipient {
  const { usable, unusable } = resolveChannels(contact, countryCode)
  return {
    contactId: contact.contactId,
    name: contact.name,
    role,
    source: mapping.outletId === null ? "franchise" : "outlet",
    usable,
    unusable,
  }
}
