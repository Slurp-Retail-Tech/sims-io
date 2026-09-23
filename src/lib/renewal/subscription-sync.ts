/**
 * What the nightly sync should write when it compares a POS outlet against the
 * subscription row SIMS holds for it.
 *
 * The one rule this module exists to enforce: **once SIMS has extended an
 * expiry date, the POS import stops overwriting it.**
 *
 * That matters because `valid_until` used to live only inside
 * `merchant_outlets.raw_payload`, and `merchant-import.ts` rewrites that column
 * wholesale on every run (`raw_payload = VALUES(raw_payload)`). Anything SIMS
 * wrote there was gone by morning. `outlet_subscriptions` is the SIMS-owned
 * copy, and this module decides when the import may touch it:
 *
 *  - **Before any renewal.** POS is the only source of truth, so its value
 *    flows straight through. A correction made in POS reaches SIMS.
 *  - **After a renewal.** SIMS owns the date and pushes it to POS separately.
 *    The import no longer writes it.
 *
 * Where POS reports a date *later* than the one SIMS extended to, somebody
 * renewed that outlet outside SIMS. Neither value is safely discardable, so
 * the decision carries a drift report and a person decides. Silently taking
 * either one would either undo a real renewal or invent one.
 *
 * Identity fields -- names, status, central id -- are always refreshed from
 * POS. SIMS has no claim on those.
 *
 * Pure and runtime-free so it can be unit-tested under `node --test`.
 */

export type ValidUntilSource = "pos_seed" | "sims_extension" | "manual"

/** One outlet as the POS import sees it, with `validUntil` already normalized. */
export type PosOutletSnapshot = {
  franchiseId: string
  outletId: string
  companyName: string | null
  outletName: string | null
  centralId: string | null
  status: string | null
  validUntil: string | null
}

/** The `outlet_subscriptions` row as it stands, or null where none exists. */
export type ExistingSubscription = {
  id: string
  companyName: string | null
  outletName: string | null
  centralId: string | null
  status: string | null
  validUntil: string | null
  validUntilSource: ValidUntilSource
  lastExtendedAt: string | null
  /** Last value the import reported. Drift detection only, never authoritative. */
  posValidUntil: string | null
  isActive: boolean
}

/** POS is ahead of the date SIMS extended to: a renewal happened elsewhere. */
export type ValidUntilDrift = {
  franchiseId: string
  outletId: string
  simsValidUntil: string | null
  posValidUntil: string
}

/** Columns the sync may write. Only differing fields are populated. */
export type SubscriptionChanges = {
  companyName?: string | null
  outletName?: string | null
  centralId?: string | null
  status?: string | null
  validUntil?: string | null
  validUntilSource?: ValidUntilSource
  posValidUntil?: string | null
  isActive?: boolean
}

export type SyncDecision =
  | { action: "insert"; snapshot: PosOutletSnapshot }
  | { action: "update"; id: string; changes: SubscriptionChanges; drift: ValidUntilDrift | null }
  | { action: "unchanged"; id: string; drift: ValidUntilDrift | null }

/**
 * Normalize a `valid_until` out of the POS payload into a MySQL DATETIME
 * string in UTC.
 *
 * Mirrors `parseDate` in `src/lib/dates.ts` deliberately, including its rule
 * that a timestamp carrying no offset is read as UTC. The pool runs at
 * `time_zone = '+00:00'` and every other reader of this field already applies
 * that rule, so a different one here would shift dates by eight hours for
 * exactly the outlets whose payload omits the offset.
 *
 * Not imported from `dates.ts` because that module uses the `@/` alias, which
 * does not resolve under `node --test`.
 */
export function normalizePosValidUntil(value: unknown): string | null {
  if (typeof value !== "string") {
    return null
  }

  const trimmed = value.trim()
  if (!trimmed) {
    return null
  }

  let normalized = trimmed
  if (/^\d{4}-\d{2}-\d{2}\s/.test(normalized)) {
    normalized = normalized.replace(" ", "T")
  }
  if (!/[zZ]|[+-]\d{2}:?\d{2}$/.test(normalized)) {
    normalized = `${normalized}Z`
  }

  const parsed = new Date(normalized)
  if (Number.isNaN(parsed.valueOf())) {
    return null
  }

  return formatUtcForMysql(parsed)
}

/**
 * True once SIMS owns the date, meaning the import must not write it.
 *
 * Keyed on `lastExtendedAt` rather than on the source enum alone: the enum
 * says where the current value came from, but the timestamp is the fact that a
 * renewal actually happened. A row whose source was hand-corrected to `manual`
 * without an extension is still POS-tracked until the first renewal lands.
 */
/**
 * Whether a POS identifier can enter the renewal module safely.
 *
 * Scope keys, group keys and Actions Required guards all join identifiers
 * with `|`, so an id containing one would collide with a different
 * franchise-outlet pair. POS ids are numeric in practice; anything else,
 * blank included, is left out of the projection and logged rather than
 * escaped, because nothing downstream expects it.
 */
export function isSafeRenewalIdentifier(value: string | null | undefined): value is string {
  return typeof value === "string" && value.trim() !== "" && !value.includes("|")
}

export function simsOwnsValidUntil(existing: ExistingSubscription): boolean {
  return (
    existing.lastExtendedAt !== null ||
    existing.validUntilSource === "sims_extension"
  )
}

/**
 * Decide what the sync writes for one outlet.
 *
 * `existing` is null when the outlet has never been seen, which is the only
 * case that seeds `valid_until` from POS unconditionally.
 */
export function decideSubscriptionSync(
  snapshot: PosOutletSnapshot,
  existing: ExistingSubscription | null
): SyncDecision {
  if (!existing) {
    return { action: "insert", snapshot }
  }

  const changes: SubscriptionChanges = {}

  // Identity always follows POS; SIMS has no claim on a name or a status.
  if (snapshot.companyName !== existing.companyName) {
    changes.companyName = snapshot.companyName
  }
  if (snapshot.outletName !== existing.outletName) {
    changes.outletName = snapshot.outletName
  }
  if (snapshot.status !== existing.status) {
    changes.status = snapshot.status
  }
  // Only ever fills a gap. SIMS may have learned a central id from the renewal
  // workbook that POS does not carry, and a null from POS must not erase it.
  if (snapshot.centralId !== null && snapshot.centralId !== existing.centralId) {
    changes.centralId = snapshot.centralId
  }

  // Recorded on every pass whether or not it is authoritative, because it is
  // what makes drift detectable at all.
  if (snapshot.validUntil !== existing.posValidUntil) {
    changes.posValidUntil = snapshot.validUntil
  }

  let drift: ValidUntilDrift | null = null

  if (simsOwnsValidUntil(existing)) {
    // SIMS owns it. Do not write it. Report only the case that needs a human:
    // POS ahead of us means a renewal we do not know about.
    if (
      snapshot.validUntil !== null &&
      isAfter(snapshot.validUntil, existing.validUntil)
    ) {
      drift = {
        franchiseId: snapshot.franchiseId,
        outletId: snapshot.outletId,
        simsValidUntil: existing.validUntil,
        posValidUntil: snapshot.validUntil,
      }
    }
  } else if (snapshot.validUntil !== existing.validUntil) {
    // Still POS-tracked: take the POS value, corrections included.
    changes.validUntil = snapshot.validUntil
    changes.validUntilSource = "pos_seed"
  }

  if (Object.keys(changes).length === 0) {
    return { action: "unchanged", id: existing.id, drift }
  }

  return { action: "update", id: existing.id, changes, drift }
}

/**
 * Strict "is left later than right", with a null right treated as earlier.
 *
 * Both sides are MySQL DATETIME strings in UTC, which sort lexically, so this
 * needs no Date parsing and cannot be knocked over by a timezone.
 */
function isAfter(left: string, right: string | null): boolean {
  if (right === null) {
    return true
  }
  return left > right
}

function pad(value: number, length = 2): string {
  return String(value).padStart(length, "0")
}

function formatUtcForMysql(value: Date): string {
  return (
    `${value.getUTCFullYear()}-${pad(value.getUTCMonth() + 1)}-${pad(value.getUTCDate())}` +
    ` ${pad(value.getUTCHours())}:${pad(value.getUTCMinutes())}:${pad(value.getUTCSeconds())}` +
    `.${pad(value.getUTCMilliseconds(), 3)}`
  )
}
