/**
 * Pure rules for contact -> outlet / franchise mappings.
 *
 * A mapping is either **outlet-specific** (`outletId` set) or **franchise-wide**
 * (`outletId === null`, meaning every outlet under that franchise). Nothing here
 * touches the database: the caller fetches a contact's existing mappings and asks
 * these functions what they mean, which keeps the overlap rules unit-testable and
 * lets the API layer re-check them inside a transaction without duplicating logic.
 *
 * The database cannot enforce these rules on its own. The UNIQUE KEY on
 * (contact_id, franchise_id, outlet_id) misses two franchise-wide rows because
 * MySQL treats NULLs as distinct, and it cannot express "a franchise-wide mapping
 * and an outlet-specific mapping under the same franchise must not coexist" at
 * all.
 */

export type ContactMapping = {
  id: string
  franchiseId: string
  /** `null` means the contact represents every outlet under `franchiseId`. */
  outletId: string | null
  franchiseName?: string | null
  outletName?: string | null
  /** Accountable for this scope's renewal. At most one per franchise-and-outlet. */
  isRenewalPic?: boolean
  /** Copied on the same reminders and receipts as the PIC, on their own channels. */
  isRenewalCc?: boolean
}

export type MappingCandidate = {
  franchiseId: string
  outletId: string | null
}

export type MappingConflictReason =
  | "none"
  /** The exact same franchise/outlet pair is already mapped. */
  | "duplicate"
  /** An outlet-specific mapping is already covered by a franchise-wide one. */
  | "covered_by_franchise_wide"
  /** A franchise-wide mapping would swallow existing outlet-specific rows. */
  | "has_specific_outlets"

export type MappingConflict = {
  reason: MappingConflictReason
  /** The existing rows that caused the conflict, so the UI can name them. */
  conflicting: ContactMapping[]
}

export type MappingGroup = {
  franchiseId: string
  franchiseName: string | null
  /** True when the group contains the franchise-wide row. */
  franchiseWide: boolean
  /** Badge text: "Franchise-wide", or "1 outlet" / "N outlets". */
  badge: string
  rows: MappingGroupRow[]
}

export type MappingGroupRow = {
  mappingId: string
  title: string
  subtitle: string
  franchiseWide: boolean
  isRenewalPic: boolean
  isRenewalCc: boolean
}

const FRANCHISE_WIDE_TITLE = "All outlets under this franchise"

/**
 * Decide whether `candidate` may be added to a contact that already holds
 * `existing`.
 *
 * Order matters. `duplicate` is checked first so re-adding the identical mapping
 * reports itself rather than the broader coverage rule, which is what the UI needs
 * to surface the existing row instead of an overlap warning.
 */
export function classifyMappingConflict(
  existing: ContactMapping[],
  candidate: MappingCandidate
): MappingConflict {
  const sameFranchise = existing.filter(
    (mapping) => mapping.franchiseId === candidate.franchiseId
  )

  const duplicate = sameFranchise.filter(
    (mapping) => mapping.outletId === candidate.outletId
  )
  if (duplicate.length) {
    return { reason: "duplicate", conflicting: duplicate }
  }

  if (candidate.outletId === null) {
    // Going franchise-wide would make every existing outlet-specific row under
    // this franchise redundant. Blocked rather than silently absorbing them, so
    // staff makes the call explicitly (PRD R18).
    const specific = sameFranchise.filter((mapping) => mapping.outletId !== null)
    if (specific.length) {
      return { reason: "has_specific_outlets", conflicting: specific }
    }
    return { reason: "none", conflicting: [] }
  }

  const franchiseWide = sameFranchise.filter((mapping) => mapping.outletId === null)
  if (franchiseWide.length) {
    return { reason: "covered_by_franchise_wide", conflicting: franchiseWide }
  }

  return { reason: "none", conflicting: [] }
}

/**
 * True when the contact already covers `franchiseId` franchise-wide, so adding an
 * outlet-specific row under it would be redundant.
 *
 * Used by the ticket manual-link action, which must update the ticket but skip the
 * `contact_outlets` insert in that case.
 */
export function isCoveredByFranchiseWide(
  existing: ContactMapping[],
  franchiseId: string
): boolean {
  return existing.some(
    (mapping) => mapping.franchiseId === franchiseId && mapping.outletId === null
  )
}

export function describeMappingConflict(conflict: MappingConflict): string | null {
  const first = conflict.conflicting[0]
  const franchiseLabel = first?.franchiseName ?? first?.franchiseId ?? "this franchise"

  switch (conflict.reason) {
    case "duplicate":
      return "This contact is already mapped to that outlet."
    case "covered_by_franchise_wide":
      return `Redundant mapping. This contact is already mapped to all of ${franchiseLabel}, which covers every outlet under it.`
    case "has_specific_outlets": {
      const count = conflict.conflicting.length
      return `This contact is already mapped to ${count} specific outlet${count === 1 ? "" : "s"} under ${franchiseLabel}. Remove ${count === 1 ? "it" : "them"} first if a franchise-wide mapping is intended.`
    }
    case "none":
      return null
  }
}

/**
 * Group a contact's mappings by franchise for the detail page, preserving first-seen
 * franchise order so the list does not reshuffle as rows are added or removed.
 */
export function groupMappingsByFranchise(
  mappings: ContactMapping[]
): MappingGroup[] {
  const groups: MappingGroup[] = []

  for (const mapping of mappings) {
    let group = groups.find((entry) => entry.franchiseId === mapping.franchiseId)
    if (!group) {
      group = {
        franchiseId: mapping.franchiseId,
        franchiseName: mapping.franchiseName ?? null,
        franchiseWide: false,
        badge: "",
        rows: [],
      }
      groups.push(group)
    }

    if (!group.franchiseName && mapping.franchiseName) {
      group.franchiseName = mapping.franchiseName
    }

    if (mapping.outletId === null) {
      group.franchiseWide = true
      group.rows.push({
        mappingId: mapping.id,
        title: FRANCHISE_WIDE_TITLE,
        subtitle: "Franchise-wide mapping",
        franchiseWide: true,
        isRenewalPic: mapping.isRenewalPic ?? false,
        isRenewalCc: mapping.isRenewalCc ?? false,
      })
    } else {
      group.rows.push({
        mappingId: mapping.id,
        title: mapping.outletName ?? `Outlet ${mapping.outletId}`,
        subtitle: `OID ${mapping.outletId}`,
        franchiseWide: false,
        isRenewalPic: mapping.isRenewalPic ?? false,
        isRenewalCc: mapping.isRenewalCc ?? false,
      })
    }
  }

  for (const group of groups) {
    group.badge = group.franchiseWide
      ? "Franchise-wide"
      : `${group.rows.length} ${group.rows.length === 1 ? "outlet" : "outlets"}`
  }

  return groups
}

/**
 * Human summary of a contact's mappings, e.g.
 * "1 franchise-wide mapping · 2 outlet mappings", or "No mappings yet".
 */
export function summarizeMappings(mappings: ContactMapping[]): string {
  const wide = mappings.filter((mapping) => mapping.outletId === null).length
  const specific = mappings.length - wide
  const parts: string[] = []

  if (wide) {
    parts.push(`${wide} franchise-wide mapping${wide === 1 ? "" : "s"}`)
  }
  if (specific) {
    parts.push(`${specific} outlet mapping${specific === 1 ? "" : "s"}`)
  }

  return parts.length ? parts.join(" · ") : "No mappings yet"
}

/** Directory "Mappings" cell: "Unmapped", "1 mapping", or "N mappings". */
export function formatMappingCount(count: number): string {
  if (count <= 0) {
    return "Unmapped"
  }
  return `${count} mapping${count === 1 ? "" : "s"}`
}
