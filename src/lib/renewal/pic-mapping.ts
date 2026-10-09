/**
 * Which contact mapping to designate when Actions Required makes someone the
 * renewal PIC: one they already have, or a new one.
 *
 * A PIC is a designation on a `contact_outlets` row, so the contact must be
 * mapped at the scope being designated. Reuse wins over adding: a contact
 * already mapped to exactly this scope keeps that row, and one mapped to the
 * whole franchise already covers the outlet, so that row is designated (they
 * become the franchise PIC, which the panel says). Otherwise a row is added,
 * subject to the same overlap rules the Contacts page enforces.
 *
 * Pure and runtime-free so it is unit-tested.
 */

import { classifyMappingConflict, describeMappingConflict } from "../contact-mappings.ts"
import type { ContactMapping } from "../contact-mappings.ts"

export type PicMappingDecision =
  | { kind: "reuse"; mappingId: string; scope: "outlet" | "franchise"; isRenewalCc: boolean }
  | { kind: "add"; scope: "outlet" | "franchise" }
  | { kind: "refuse"; message: string }

export function decidePicMapping(
  existing: readonly ContactMapping[],
  target: { franchiseId: string; outletId: string | null }
): PicMappingDecision {
  const sameFranchise = existing.filter((mapping) => mapping.franchiseId === target.franchiseId)

  const exact = sameFranchise.find((mapping) => mapping.outletId === target.outletId)
  if (exact) {
    return {
      kind: "reuse",
      mappingId: exact.id,
      scope: exact.outletId === null ? "franchise" : "outlet",
      isRenewalCc: Boolean(exact.isRenewalCc),
    }
  }

  if (target.outletId !== null) {
    const franchiseWide = sameFranchise.find((mapping) => mapping.outletId === null)
    if (franchiseWide) {
      return { kind: "reuse", mappingId: franchiseWide.id, scope: "franchise", isRenewalCc: Boolean(franchiseWide.isRenewalCc) }
    }
  }

  const conflict = classifyMappingConflict([...existing], target)
  if (conflict.reason !== "none") {
    return {
      kind: "refuse",
      message: describeMappingConflict(conflict) ?? "This contact's existing mappings conflict with that scope.",
    }
  }
  return { kind: "add", scope: target.outletId === null ? "franchise" : "outlet" }
}
