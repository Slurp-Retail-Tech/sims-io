/**
 * Why a merchant did not renew: the fixed list staff choose from, so the
 * answer can be counted.
 *
 * Free text would read well on one outlet and be useless across a hundred.
 * The list is the team's own: change of ownership, closed business, switched
 * system, a frozen account and a temporary closure, plus Other with a note
 * for anything they do not cover. Temporary reasons are marked so the
 * analytics can tell merchants who may come back from those who will not.
 *
 * Pure and runtime-free; shared by the API, the dialogs and the metrics.
 */

export const NON_RENEWAL_REASONS = [
  {
    value: "change_of_ownership",
    label: "Change of ownership",
    description: "The business was sold or taken over; the new owner has not renewed.",
    temporary: false,
  },
  {
    value: "closed_business",
    label: "Closed business",
    description: "The outlet has closed for good.",
    temporary: false,
  },
  {
    value: "switched_system",
    label: "Switched system",
    description: "The merchant moved to another POS.",
    temporary: false,
  },
  {
    value: "freeze_account",
    label: "Freeze account",
    description: "The merchant asked to freeze the account for now, keeping their data.",
    temporary: true,
  },
  {
    value: "temp_close",
    label: "Temporarily closed",
    description: "Closed for renovation, a season or a move, expected to reopen.",
    temporary: true,
  },
  {
    value: "other",
    label: "Other",
    description: "Anything the reasons above do not cover. Say what in the note.",
    temporary: false,
  },
] as const

export type NonRenewalReason = (typeof NON_RENEWAL_REASONS)[number]["value"]

export const NON_RENEWAL_REASON_VALUES = NON_RENEWAL_REASONS.map((reason) => reason.value) as [
  NonRenewalReason,
  ...NonRenewalReason[],
]

export function isNonRenewalReason(value: unknown): value is NonRenewalReason {
  return NON_RENEWAL_REASONS.some((reason) => reason.value === value)
}

export function nonRenewalLabel(reason: string): string {
  return NON_RENEWAL_REASONS.find((entry) => entry.value === reason)?.label ?? reason
}

/** A note is required for Other, where the label alone says nothing. */
export function validateNonRenewal(reason: NonRenewalReason, note: string | null): string | null {
  if (reason === "other" && !note?.trim()) {
    return "Say why in the note when the reason is Other."
  }
  if (note && note.length > 1000) {
    return "Keep the note under 1,000 characters."
  }
  return null
}
