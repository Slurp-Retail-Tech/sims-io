/**
 * Resolve a franchise id (fid) and optional outlet id (oid) to display names.
 *
 * This was duplicated verbatim in `src/app/api/tickets/[ticketId]/route.ts` and
 * `src/app/api/supportform/submit/route.ts`, and both copies **required** an oid.
 * The Respond.io automation needs the franchise-only case too: a franchise-wide
 * contact mapping pre-fills `tickets.fid` and deliberately leaves `oid` unset, and
 * that ticket still has to show a franchise name.
 *
 * Both original copies matched on `merchants.fid` alone. This version matches
 * `fid = ? OR external_id = ?`, the same pair `buildMerchantOutletResolver` in
 * `src/lib/merchant-lookup.ts` uses -- the two columns are equal and unique per
 * merchant, but `merchants.fid` is nullable and may be sparse, so accepting either
 * avoids a lookup that silently resolves to nothing.
 */

import type { RowDataPacket } from "mysql2/promise"

import type { Queryable } from "./db.ts"

export type ResolvedMerchantNames = {
  franchiseName: string | null
  outletName: string | null
}

type NameRow = RowDataPacket & {
  franchise_name: string | null
  outlet_name: string | null
}

const EMPTY: ResolvedMerchantNames = { franchiseName: null, outletName: null }

/**
 * Pick the better of two candidate rows.
 *
 * The franchise-keyed lookup is authoritative for the franchise name, but its
 * LEFT JOIN yields a null outlet name when the outlet id belongs to a different
 * merchant. The outlet-keyed fallback fills that in rather than reporting an
 * unlinked outlet as "not found".
 */
export function pickMerchantNames(
  primary: ResolvedMerchantNames | null,
  fallback: ResolvedMerchantNames | null
): ResolvedMerchantNames {
  if (!primary && !fallback) {
    return EMPTY
  }

  return {
    franchiseName: primary?.franchiseName ?? fallback?.franchiseName ?? null,
    outletName: primary?.outletName ?? fallback?.outletName ?? null,
  }
}

/**
 * Takes a `Queryable`, not a `Pool`, so a caller inside an open transaction can
 * pass its own connection. Passing the pool from inside a transaction checks
 * out a SECOND connection while the first is held — the read then runs outside
 * the transaction's snapshot, and against connectionLimit 10 with queueLimit 0
 * (wait forever) it is a self-deadlock vector under load.
 */
export async function resolveMerchantNames(
  db: Queryable,
  fid: string | null,
  oid: string | null
): Promise<ResolvedMerchantNames> {
  const trimmedFid = fid?.trim() ?? ""
  const trimmedOid = oid?.trim() ?? ""

  if (!trimmedFid && !trimmedOid) {
    return EMPTY
  }

  let primary: ResolvedMerchantNames | null = null

  if (trimmedFid) {
    const [rows] = await db.query<NameRow[]>(
      `
      SELECT
        merchants.name AS franchise_name,
        merchant_outlets.name AS outlet_name
      FROM merchants
      LEFT JOIN merchant_outlets
        ON merchant_outlets.merchant_external_id = merchants.external_id
        AND merchant_outlets.external_id = ?
      WHERE merchants.fid = ? OR merchants.external_id = ?
      LIMIT 1
    `,
      [trimmedOid, trimmedFid, trimmedFid]
    )

    const row = rows[0]
    if (row) {
      primary = {
        franchiseName: row.franchise_name ?? null,
        outletName: row.outlet_name ?? null,
      }
    }
  }

  // Nothing more to look up: without an oid the franchise query is the whole answer.
  if (!trimmedOid) {
    return pickMerchantNames(primary, null)
  }

  if (primary?.franchiseName && primary.outletName) {
    return primary
  }

  const [fallbackRows] = await db.query<NameRow[]>(
    `
    SELECT
      merchants.name AS franchise_name,
      merchant_outlets.name AS outlet_name
    FROM merchant_outlets
    INNER JOIN merchants
      ON merchants.external_id = merchant_outlets.merchant_external_id
    WHERE merchant_outlets.external_id = ?
    LIMIT 1
  `,
    [trimmedOid]
  )

  const fallbackRow = fallbackRows[0]
  const fallback: ResolvedMerchantNames | null = fallbackRow
    ? {
        franchiseName: fallbackRow.franchise_name ?? null,
        outletName: fallbackRow.outlet_name ?? null,
      }
    : null

  return pickMerchantNames(primary, fallback)
}
