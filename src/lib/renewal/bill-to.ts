/**
 * The Bill To snapshot a renewal document carries in `bill_to_json`.
 *
 * Kept apart from `billing-profiles.ts`, which reads spreadsheets and the
 * database, so the invoice loaders and the export can parse a snapshot
 * without pulling either in. Pure and runtime-free.
 */

import type { BillToDetails } from "./document-content.ts"

/** The printed details, and the Bukku contact behind them for the export. */
export type BillToSnapshot = BillToDetails & { bukkuContactCode: string | null }

export function snapshotOf(profile: BillToSnapshot): BillToSnapshot {
  return {
    bukkuContactCode: profile.bukkuContactCode,
    legalName: profile.legalName,
    regNoType: profile.regNoType,
    registrationNo: profile.registrationNo,
    oldRegistrationNo: profile.oldRegistrationNo,
    tin: profile.tin,
    sstNo: profile.sstNo,
    street: profile.street,
    city: profile.city,
    state: profile.state,
    postcode: profile.postcode,
    country: profile.country,
  }
}

/** The printed details alone: what the merchant's page is sent. */
export function detailsOf(snapshot: BillToSnapshot | null): BillToDetails | null {
  if (!snapshot) {
    return null
  }
  const { bukkuContactCode: _contactCode, ...details } = snapshot
  void _contactCode
  return details
}

/**
 * Read `bill_to_json` defensively: mysql2 hands back a parsed object or the
 * raw string depending on driver version, and older rows hold NULL.
 */
export function parseBillToSnapshot(value: unknown): BillToSnapshot | null {
  const raw = typeof value === "string" ? safeParse(value) : value
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return null
  }
  const record = raw as Record<string, unknown>
  const read = (key: keyof BillToSnapshot): string | null => {
    const entry = record[key]
    return typeof entry === "string" && entry.trim() ? entry : null
  }
  return {
    bukkuContactCode: read("bukkuContactCode"),
    legalName: read("legalName"),
    regNoType: read("regNoType"),
    registrationNo: read("registrationNo"),
    oldRegistrationNo: read("oldRegistrationNo"),
    tin: read("tin"),
    sstNo: read("sstNo"),
    street: read("street"),
    city: read("city"),
    state: read("state"),
    postcode: read("postcode"),
    country: read("country"),
  }
}

function safeParse(value: string): unknown {
  try {
    return JSON.parse(value)
  } catch {
    return null
  }
}
