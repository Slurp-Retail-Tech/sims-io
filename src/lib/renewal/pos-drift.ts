/**
 * The POS showing a later expiry than SIMS extended to.
 *
 * Once SIMS has extended an outlet it owns the date, and the nightly sync
 * stops copying the POS value over it (see `subscription-sync.ts`). A later
 * POS date after that means somebody renewed the outlet outside SIMS: a
 * payment taken by hand, or a date set in the POS directly. Neither value is
 * safely discardable, so it is raised as an informational queue entry and a
 * person decides.
 *
 * The one remedy SIMS offers is **Accept POS date**: take the POS value as
 * the SIMS date. The sync cannot do that on its own, because it cannot tell
 * a real outside renewal from a POS mistake. Otherwise the entry clears by
 * itself once the two dates agree again, for example after the POS is
 * corrected.
 *
 * This is also the other half of the stale-proforma story. While the entry
 * is open, SIMS still bills from its own, earlier date, so an open proforma
 * for the outlet is named here: it may bill a renewal the merchant has
 * already paid for. Accepting the POS date moves the SIMS date, and the next
 * nightly run then reports that proforma as stale.
 *
 * Pure and runtime-free so the wording and the acceptance rule are tested.
 */

import type { ValidUntilDrift } from "./subscription-sync.ts"

export type DriftAction = {
  franchiseId: string
  outletId: string
  invoiceId: string | null
  detail: string
}

/** Build the queue entry for one drift, naming any open proforma. */
export function buildDriftAction(
  drift: ValidUntilDrift,
  openProforma: { invoiceId: string; invoiceNumber: string } | null
): DriftAction {
  const sims = dateOnly(drift.simsValidUntil) ?? "no date"
  const pos = dateOnly(drift.posValidUntil) ?? "no date"
  const base = `The POS shows this licence running to ${pos}; SIMS extended it to ${sims}. It was probably renewed outside SIMS. If that renewal is real, accept the POS date; if the POS is wrong, correct it there.`
  const invoiceNote = openProforma
    ? ` ${openProforma.invoiceNumber} is open for this outlet and may bill a renewal already paid for.`
    : ""
  return {
    franchiseId: drift.franchiseId,
    outletId: drift.outletId,
    invoiceId: openProforma?.invoiceId ?? null,
    detail: base + invoiceNote,
  }
}

export type AcceptDecision =
  | { ok: true; validUntil: string }
  | { ok: false; reason: "no_pos_date" | "not_later" }

/**
 * Whether the POS date can be taken as the SIMS date now.
 *
 * Only ever forward: the entry exists because the POS is *ahead*. If the
 * dates have since converged or the POS has gone backwards, there is nothing
 * to accept, and taking an earlier date would shorten a paid licence.
 */
export function decideAcceptPosDate(
  simsValidUntil: string | null,
  posValidUntil: string | null
): AcceptDecision {
  if (!posValidUntil) {
    return { ok: false, reason: "no_pos_date" }
  }
  if (simsValidUntil !== null && posValidUntil <= simsValidUntil) {
    return { ok: false, reason: "not_later" }
  }
  return { ok: true, validUntil: posValidUntil }
}

function dateOnly(value: string | null): string | null {
  return value ? value.slice(0, 10) : null
}
