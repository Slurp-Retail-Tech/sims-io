import { NextRequest, NextResponse } from "next/server"

import { resolveApiUser } from "@/lib/api-auth"

import { queryWithReconnect, withTransaction } from "@/lib/db"
import { mapContact, mapContactPhone } from "@/lib/contacts"
import type {
  Contact,
  ContactPhone,
  ContactPhoneRow,
  ContactRow,
} from "@/lib/contacts"
import type { ContactMapping } from "@/lib/contact-mappings"
import type { PoolConnection, RowDataPacket } from "mysql2/promise"

export const CONTACTS_ACCESS_PATH = "/contacts"

export type ContactsAuthUser = {
  id: string
  name: string
  email: string
  role: string
  pageAccess: string[]
}

/**
 * Resolves the authenticated user and enforces the Contacts module gate.
 *
 * Mirrors `resolveProjectsUser`. There is no per-record scoping beyond this: every
 * staff member who holds the `/contacts` key may view, create and edit any contact
 * and its mappings (PRD R5).
 */
export async function resolveContactsUser(
  request: NextRequest
): Promise<{ user: ContactsAuthUser } | { response: NextResponse }> {
  return resolveApiUser(request, { allowedPaths: [CONTACTS_ACCESS_PATH] })
}

export function parseContactId(value: string): number | null {
  const parsed = Number.parseInt(value, 10)
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null
  }
  return parsed
}

export function cleanString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null
  }
  const trimmed = value.trim()
  return trimmed ? trimmed : null
}

/**
 * Load phone numbers for a set of contacts in one query.
 *
 * The directory renders a phone cell per row, so fetching per contact would be N+1
 * against the page size. Primary numbers sort first so `phones[0]` is always the one
 * the UI displays.
 */
export async function loadPhonesForContacts(
  contactIds: readonly string[]
): Promise<Map<string, ContactPhone[]>> {
  const byContact = new Map<string, ContactPhone[]>()
  if (!contactIds.length) {
    return byContact
  }

  const placeholders = contactIds.map(() => "?").join(", ")
  const [rows] = await queryWithReconnect<ContactPhoneRow[]>(
    `SELECT id, contact_id, phone, is_primary
     FROM contact_phone_numbers
     WHERE contact_id IN (${placeholders})
     ORDER BY is_primary DESC, id ASC`,
    [...contactIds]
  )

  for (const row of rows) {
    const key = String(row.contact_id)
    const existing = byContact.get(key)
    const phone = mapContactPhone(row)
    if (existing) {
      existing.push(phone)
    } else {
      byContact.set(key, [phone])
    }
  }

  return byContact
}

export async function attachPhones(rows: ContactRow[]): Promise<Contact[]> {
  const phones = await loadPhonesForContacts(rows.map((row) => String(row.id)))
  return rows.map((row) => mapContact(row, phones.get(String(row.id)) ?? []))
}

type MappingRow = RowDataPacket & {
  id: number | string
  franchise_id: string
  outlet_id: string | null
  franchise_name: string | null
  outlet_name: string | null
}

/**
 * A contact's mappings, with franchise and outlet names resolved from the local
 * merchant cache.
 *
 * The joins are LEFT joins on business keys, not FKs: a mapping may reference a
 * franchise or outlet the merchant import has not seen yet, and the mapping is still
 * valid — the UI falls back to showing the raw id.
 *
 * Pass `connection` to read inside an open transaction, which the overlap re-check
 * requires.
 */
export async function loadContactMappings(
  contactId: number | string,
  connection?: PoolConnection
): Promise<ContactMapping[]> {
  const sql = `
    SELECT
      contact_outlets.id,
      contact_outlets.franchise_id,
      contact_outlets.outlet_id,
      merchants.name AS franchise_name,
      merchant_outlets.name AS outlet_name
    FROM contact_outlets
    LEFT JOIN merchants
      ON merchants.fid = contact_outlets.franchise_id
      OR merchants.external_id = contact_outlets.franchise_id
    LEFT JOIN merchant_outlets
      ON merchant_outlets.external_id = contact_outlets.outlet_id
      AND merchant_outlets.merchant_external_id = merchants.external_id
    WHERE contact_outlets.contact_id = ?
    ORDER BY contact_outlets.franchise_id ASC, contact_outlets.outlet_id IS NULL DESC, contact_outlets.outlet_id ASC
  `

  const [rows] = connection
    ? await connection.query<MappingRow[]>(sql, [contactId])
    : await queryWithReconnect<MappingRow[]>(sql, [contactId])

  return rows.map((row) => ({
    id: String(row.id),
    franchiseId: row.franchise_id,
    outletId: row.outlet_id,
    franchiseName: row.franchise_name,
    outletName: row.outlet_name,
  }))
}

/** Mapping counts for many contacts at once, for the directory's "Mappings" cell. */
export async function loadMappingCounts(
  contactIds: readonly string[]
): Promise<Map<string, number>> {
  const counts = new Map<string, number>()
  if (!contactIds.length) {
    return counts
  }

  const placeholders = contactIds.map(() => "?").join(", ")
  const [rows] = await queryWithReconnect<
    Array<RowDataPacket & { contact_id: number | string; total: number | string }>
  >(
    `SELECT contact_id, COUNT(*) AS total
     FROM contact_outlets
     WHERE contact_id IN (${placeholders})
     GROUP BY contact_id`,
    [...contactIds]
  )

  for (const row of rows) {
    const total =
      typeof row.total === "string" ? Number.parseInt(row.total, 10) : row.total
    counts.set(String(row.contact_id), Number.isNaN(total) ? 0 : total)
  }

  return counts
}

/**
 * Runs `work` inside a transaction holding a row lock on the contact.
 *
 * The contact row is the mutex for both the duplicate check and the mapping overlap
 * check. Both read-then-write, and without the lock two concurrent submissions each
 * pass validation in isolation and then both insert — which is exactly the "two staff
 * create the same phone at nearly the same time" edge case.
 */
export async function withContactLock<T>(
  contactId: number | string,
  work: (connection: PoolConnection) => Promise<T>
): Promise<T> {
  return withTransaction(async (connection) => {
    await connection.query(`SELECT id FROM contacts WHERE id = ? FOR UPDATE`, [
      contactId,
    ])
    return work(connection)
  })
}

// Re-exported so the existing call site keeps its import path. The
// implementation moved to src/lib/db.ts: this file imports next/server, so
// anything reaching withTransaction through it cannot be unit-tested under
// `node --test`.
export { withTransaction }
