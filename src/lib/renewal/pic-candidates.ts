/**
 * Who could be made renewal PIC for an outlet, for the panel Actions Required
 * opens on "Set renewal PIC".
 *
 * A PIC is a designation on a contact mapping, so the candidates are the
 * contacts mapped to this outlet or to its whole franchise. A franchise-wide
 * mapping designates the PIC for every outlet that has no outlet-specific
 * one; an outlet mapping, for this outlet only. Each candidate says whether a
 * message could actually reach them, using the same rule as the nightly
 * check, so the panel cannot pick someone the cycle would then reject.
 *
 * Pure and runtime-free so it is unit-tested.
 */

import { resolveChannels } from "./pic-resolution.ts"
import type { Channel, RenewalContact, RenewalMapping } from "./pic-resolution.ts"

export type PicCandidate = {
  mappingId: string
  contactId: string
  name: string
  email: string | null
  phone: string | null
  scope: "outlet" | "franchise"
  isRenewalPic: boolean
  isRenewalCc: boolean
  /** Enabled channels that hold an address. Empty means unreachable. */
  usable: Channel[]
  /** Enabled channels missing their address. */
  unusable: Channel[]
}

/**
 * `outletId` null asks for franchise-wide candidates only: the fix for a
 * grouped invoice whose outlets resolve to different PICs is a single
 * franchise-wide one.
 *
 * Ordered so the likely choice is first: reachable before unreachable, this
 * outlet's own contacts before franchise-wide ones, then by name.
 */
export function buildPicCandidates(
  directory: { mappings: readonly RenewalMapping[]; contacts: ReadonlyMap<string, RenewalContact> },
  outletId: string | null
): PicCandidate[] {
  const candidates: PicCandidate[] = []
  for (const mapping of directory.mappings) {
    const inScope = mapping.outletId === null || (outletId !== null && mapping.outletId === outletId)
    const contact = directory.contacts.get(mapping.contactId)
    if (!inScope || !contact || !mapping.mappingId) {
      continue
    }
    const channels = resolveChannels(contact)
    candidates.push({
      mappingId: mapping.mappingId,
      contactId: contact.contactId,
      name: contact.name,
      email: contact.email,
      phone: contact.primaryPhone,
      scope: mapping.outletId === null ? "franchise" : "outlet",
      isRenewalPic: mapping.isRenewalPic,
      isRenewalCc: mapping.isRenewalCc,
      usable: channels.usable.map((channel) => channel.channel),
      unusable: channels.unusable,
    })
  }

  return candidates.sort(
    (a, b) =>
      Number(b.usable.length > 0) - Number(a.usable.length > 0) ||
      Number(b.scope === "outlet") - Number(a.scope === "outlet") ||
      a.name.localeCompare(b.name)
  )
}
