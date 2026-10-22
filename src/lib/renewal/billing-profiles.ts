/**
 * Billing profiles: who each franchise's renewal documents are billed to.
 *
 * A profile holds the registered name, registration numbers, TIN and billing
 * address printed under Bill To. Most come from the Bukku Contacts export,
 * matched to franchises by name or email (see `bukku-contacts.ts`); the rest
 * are confirmed or typed in by staff on the Billing Profiles page.
 *
 * Each document snapshots its franchise's profile into `bill_to_json`. Open
 * proformas follow the profile as it changes, and lose their stored PDF so
 * the next download prints the new details. A paid proforma, and the tax
 * invoice that settles it, keep the details they were paid against.
 */

import { randomUUID } from "node:crypto"

import getPool, { withTransaction, type Queryable } from "../db.ts"
import type { ResultSetHeader, RowDataPacket } from "mysql2/promise"
import * as XLSX from "xlsx"

import { matchContactsToFranchises, parseBukkuContactRows } from "./bukku-contacts.ts"
import type { BukkuContact, ContactMatch, FranchiseIdentity } from "./bukku-contacts.ts"
import { snapshotOf } from "./bill-to.ts"
import type { BillToSnapshot } from "./bill-to.ts"
import type { BillToDetails } from "./document-content.ts"

export type BillingProfile = BillToSnapshot & {
  franchiseId: string
  source: "bukku" | "manual"
  matchStatus: "auto" | "confirmed" | "manual"
  updatedAt: string | null
}

export type BillingProfileInput = Omit<BillToDetails, "legalName"> & { legalName: string }

/** One franchise on the Billing Profiles page. */
export type BillingProfileRow = {
  franchiseId: string
  companyName: string | null
  outletCount: number
  profile: BillingProfile | null
  /** For a franchise with no profile: the contacts the matcher could not choose between. */
  candidates: Array<{ contactCode: string; legalName: string; registrationNo: string | null; tin: string | null }>
}

export type ImportSummary = {
  batchId: string
  contacts: number
  skipped: Array<{ row: number; reason: string }>
  /** Franchises given a profile by this import. */
  matched: number
  /** Profiles already linked to a contact whose details this import refreshed. */
  refreshed: number
  /** Franchises with several candidate contacts, left for a person to pick. */
  needsReview: number
  /** Franchises no contact fits. */
  unmatched: number
  /** Profiles edited by hand, which imports never overwrite. */
  keptManual: number
}

/** Statuses on which a proforma's Bill To still follows the profile. */
const OPEN_STATUSES = ["draft", "issued", "sent", "payment_pending"] as const

type ProfileRow = RowDataPacket & {
  franchise_id: string
  bukku_contact_code: string | null
  legal_name: string | null
  reg_no_type: string | null
  registration_no: string | null
  old_registration_no: string | null
  tin: string | null
  sst_no: string | null
  billing_street: string | null
  billing_city: string | null
  billing_state: string | null
  billing_postcode: string | null
  billing_country: string | null
  source: "bukku" | "manual"
  match_status: "auto" | "confirmed" | "manual"
  updated_at: string | null
}

const PROFILE_COLUMNS = `franchise_id, bukku_contact_code, legal_name, reg_no_type, registration_no,
  old_registration_no, tin, sst_no, billing_street, billing_city, billing_state,
  billing_postcode, billing_country, source, match_status, updated_at`

function mapProfile(row: ProfileRow): BillingProfile {
  return {
    franchiseId: row.franchise_id,
    bukkuContactCode: row.bukku_contact_code,
    legalName: row.legal_name,
    regNoType: row.reg_no_type,
    registrationNo: row.registration_no,
    oldRegistrationNo: row.old_registration_no,
    tin: row.tin,
    sstNo: row.sst_no,
    street: row.billing_street,
    city: row.billing_city,
    state: row.billing_state,
    postcode: row.billing_postcode,
    country: row.billing_country,
    source: row.source,
    matchStatus: row.match_status,
    updatedAt: row.updated_at,
  }
}

function contactSnapshot(contact: BukkuContact): BillToSnapshot {
  return {
    bukkuContactCode: contact.contactCode,
    legalName: contact.legalName,
    regNoType: contact.regNoType,
    registrationNo: contact.registrationNo,
    oldRegistrationNo: contact.oldRegistrationNo,
    tin: contact.tin,
    sstNo: contact.sstNo,
    street: contact.billingStreet,
    city: contact.billingCity,
    state: contact.billingState,
    postcode: contact.billingPostcode,
    country: contact.billingCountry,
  }
}

export async function loadBillingProfile(
  franchiseId: string,
  db: Queryable = getPool()
): Promise<BillingProfile | null> {
  const [rows] = await db.query<ProfileRow[]>(
    `SELECT ${PROFILE_COLUMNS} FROM renewal_billing_profiles WHERE franchise_id = ?`,
    [franchiseId]
  )
  return rows[0] ? mapProfile(rows[0]) : null
}

/** The snapshot a new document for this franchise carries, or null with no profile. */
export async function billToSnapshotFor(
  franchiseId: string,
  db: Queryable = getPool()
): Promise<BillToSnapshot | null> {
  const profile = await loadBillingProfile(franchiseId, db)
  return profile ? snapshotOf(profile) : null
}

/**
 * Point every open proforma of these franchises at their current profile and
 * drop its stored PDF, which `ensureInvoicePdf` re-renders on next use.
 * Returns how many documents changed.
 */
export async function refreshOpenDocuments(
  franchiseIds: readonly string[],
  db: Queryable = getPool()
): Promise<number> {
  if (franchiseIds.length === 0) {
    return 0
  }
  const [result] = await db.query<ResultSetHeader>(
    `UPDATE renewal_invoices i
       LEFT JOIN renewal_billing_profiles p ON p.franchise_id = i.franchise_id
        SET i.bill_to_json = CASE WHEN p.id IS NULL THEN NULL ELSE JSON_OBJECT(
              'bukkuContactCode', p.bukku_contact_code, 'legalName', p.legal_name,
              'regNoType', p.reg_no_type, 'registrationNo', p.registration_no,
              'oldRegistrationNo', p.old_registration_no, 'tin', p.tin, 'sstNo', p.sst_no,
              'street', p.billing_street, 'city', p.billing_city, 'state', p.billing_state,
              'postcode', p.billing_postcode, 'country', p.billing_country) END,
            i.pdf_object_key = NULL
      WHERE i.franchise_id IN (${franchiseIds.map(() => "?").join(", ")})
        AND i.document_type = 'proforma'
        AND i.deleted_at IS NULL
        AND i.status IN (${OPEN_STATUSES.map(() => "?").join(", ")})`,
    [...franchiseIds, ...OPEN_STATUSES]
  )
  return result.affectedRows
}

/** What SIMS knows each renewal franchise by: company and outlet names, PIC and payer emails. */
async function loadFranchiseIdentities(db: Queryable): Promise<FranchiseIdentity[]> {
  const [nameRows] = await db.query<RowDataPacket[]>(
    `SELECT s.franchise_id, s.company_name, s.outlet_name, m.name AS merchant_name
       FROM outlet_subscriptions s
       LEFT JOIN merchants m ON m.external_id = s.franchise_id
      WHERE s.deleted_at IS NULL`
  )
  const [emailRows] = await db.query<RowDataPacket[]>(
    `SELECT co.franchise_id, c.email
       FROM contact_outlets co
       INNER JOIN contacts c ON c.id = co.contact_id AND c.deleted_at IS NULL
      UNION
     SELECT franchise_id, payment_email AS email
       FROM renewal_invoices
      WHERE payment_email IS NOT NULL AND deleted_at IS NULL`
  )

  const identities = new Map<string, { names: Set<string>; emails: Set<string> }>()
  const entry = (franchiseId: string) => {
    const existing = identities.get(franchiseId)
    if (existing) return existing
    const created = { names: new Set<string>(), emails: new Set<string>() }
    identities.set(franchiseId, created)
    return created
  }
  for (const row of nameRows as Array<Record<string, string | null>>) {
    const target = entry(String(row.franchise_id))
    for (const name of [row.company_name, row.merchant_name, row.outlet_name]) {
      if (name) target.names.add(name)
    }
  }
  for (const row of emailRows as Array<Record<string, string | null>>) {
    // Only franchises in the renewal book; a contact on some other merchant is not a candidate.
    const target = identities.get(String(row.franchise_id))
    if (target && row.email) target.emails.add(row.email.toLowerCase())
  }
  return [...identities].map(([franchiseId, { names, emails }]) => ({
    franchiseId,
    names: [...names],
    emails: [...emails],
  }))
}

type ContactRow = RowDataPacket & {
  contact_code: string
  legal_name: string
  other_name: string | null
  entity_type: string | null
  reg_no_type: string | null
  registration_no: string | null
  old_registration_no: string | null
  tin: string | null
  sst_no: string | null
  emails: string | null
  phones: string | null
  billing_street: string | null
  billing_city: string | null
  billing_state: string | null
  billing_postcode: string | null
  billing_country: string | null
}

function mapContact(row: ContactRow): BukkuContact {
  return {
    contactCode: row.contact_code,
    legalName: row.legal_name,
    otherName: row.other_name,
    entityType: row.entity_type,
    regNoType: row.reg_no_type,
    registrationNo: row.registration_no,
    oldRegistrationNo: row.old_registration_no,
    tin: row.tin,
    sstNo: row.sst_no,
    emails: row.emails ? row.emails.split(",").filter(Boolean) : [],
    phones: row.phones,
    billingStreet: row.billing_street,
    billingCity: row.billing_city,
    billingState: row.billing_state,
    billingPostcode: row.billing_postcode,
    billingCountry: row.billing_country,
  }
}

async function loadContacts(db: Queryable, codes?: readonly string[]): Promise<BukkuContact[]> {
  if (codes && codes.length === 0) {
    return []
  }
  const [rows] = await db.query<ContactRow[]>(
    `SELECT contact_code, legal_name, other_name, entity_type, reg_no_type, registration_no,
            old_registration_no, tin, sst_no, emails, phones, billing_street, billing_city,
            billing_state, billing_postcode, billing_country
       FROM renewal_bukku_contacts
      ${codes ? `WHERE contact_code IN (${codes.map(() => "?").join(", ")})` : ""}`,
    codes ? [...codes] : []
  )
  return rows.map(mapContact)
}

async function writeProfile(
  db: Queryable,
  franchiseId: string,
  snapshot: BillToSnapshot,
  source: BillingProfile["source"],
  matchStatus: BillingProfile["matchStatus"],
  userId: string | null
): Promise<void> {
  await db.query<ResultSetHeader>(
    `INSERT INTO renewal_billing_profiles
       (franchise_id, bukku_contact_code, legal_name, reg_no_type, registration_no,
        old_registration_no, tin, sst_no, billing_street, billing_city, billing_state,
        billing_postcode, billing_country, source, match_status, updated_by_user_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       bukku_contact_code = VALUES(bukku_contact_code), legal_name = VALUES(legal_name),
       reg_no_type = VALUES(reg_no_type), registration_no = VALUES(registration_no),
       old_registration_no = VALUES(old_registration_no), tin = VALUES(tin), sst_no = VALUES(sst_no),
       billing_street = VALUES(billing_street), billing_city = VALUES(billing_city),
       billing_state = VALUES(billing_state), billing_postcode = VALUES(billing_postcode),
       billing_country = VALUES(billing_country), source = VALUES(source),
       match_status = VALUES(match_status), updated_by_user_id = VALUES(updated_by_user_id)`,
    [
      franchiseId,
      snapshot.bukkuContactCode,
      snapshot.legalName,
      snapshot.regNoType,
      snapshot.registrationNo,
      snapshot.oldRegistrationNo,
      snapshot.tin,
      snapshot.sstNo,
      snapshot.street,
      snapshot.city,
      snapshot.state,
      snapshot.postcode,
      snapshot.country,
      source,
      matchStatus,
      userId,
    ]
  )
}

/** Rows inserted per statement when storing the contacts; a full export is a few thousand. */
const CONTACT_CHUNK = 250

/**
 * Import a Bukku Contacts export (.xlsx or .csv bytes).
 *
 * Stores every contact, then:
 * - refreshes each profile already linked to a contact, unless edited by hand;
 * - creates a profile for each franchise without one that matches exactly one contact;
 * - leaves ambiguous and unmatched franchises for the Billing Profiles page.
 */
export async function importBukkuContacts(
  bytes: Buffer,
  userId: string | null
): Promise<ImportSummary> {
  const workbook = XLSX.read(bytes, { type: "buffer", raw: true, cellDates: false })
  const sheet = workbook.Sheets[workbook.SheetNames[0] ?? ""]
  if (!sheet) {
    throw new ImportError("The file has no worksheet.")
  }
  const rows = XLSX.utils.sheet_to_json<Array<string | number | null>>(sheet, { header: 1, raw: false, defval: null })
  let parsed: ReturnType<typeof parseBukkuContactRows>
  try {
    parsed = parseBukkuContactRows(rows)
  } catch (error) {
    throw new ImportError(error instanceof Error ? error.message : "The file could not be read.")
  }
  if (parsed.contacts.length === 0) {
    throw new ImportError("The file has no contacts in it.")
  }

  const batchId = randomUUID()
  const contactsByCode = new Map(parsed.contacts.map((contact) => [contact.contactCode, contact]))

  const outcome = await withTransaction(async (connection) => {
    for (let start = 0; start < parsed.contacts.length; start += CONTACT_CHUNK) {
      const chunk = parsed.contacts.slice(start, start + CONTACT_CHUNK)
      await connection.query<ResultSetHeader>(
        `INSERT INTO renewal_bukku_contacts
           (contact_code, legal_name, other_name, entity_type, reg_no_type, registration_no,
            old_registration_no, tin, sst_no, emails, phones, billing_street, billing_city,
            billing_state, billing_postcode, billing_country, import_batch_id, imported_by_user_id)
         VALUES ${chunk.map(() => "(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").join(", ")}
         ON DUPLICATE KEY UPDATE
           legal_name = VALUES(legal_name), other_name = VALUES(other_name),
           entity_type = VALUES(entity_type), reg_no_type = VALUES(reg_no_type),
           registration_no = VALUES(registration_no), old_registration_no = VALUES(old_registration_no),
           tin = VALUES(tin), sst_no = VALUES(sst_no), emails = VALUES(emails), phones = VALUES(phones),
           billing_street = VALUES(billing_street), billing_city = VALUES(billing_city),
           billing_state = VALUES(billing_state), billing_postcode = VALUES(billing_postcode),
           billing_country = VALUES(billing_country), import_batch_id = VALUES(import_batch_id),
           imported_by_user_id = VALUES(imported_by_user_id), imported_at = CURRENT_TIMESTAMP(3)`,
        chunk.flatMap((contact) => [
          contact.contactCode,
          contact.legalName,
          contact.otherName,
          contact.entityType,
          contact.regNoType,
          contact.registrationNo,
          contact.oldRegistrationNo,
          contact.tin,
          contact.sstNo,
          contact.emails.join(",") || null,
          contact.phones,
          contact.billingStreet,
          contact.billingCity,
          contact.billingState,
          contact.billingPostcode,
          contact.billingCountry,
          batchId,
          userId,
        ])
      )
    }

    const [profileRows] = await connection.query<ProfileRow[]>(`SELECT ${PROFILE_COLUMNS} FROM renewal_billing_profiles`)
    const profiles = new Map(profileRows.map((row) => [row.franchise_id, mapProfile(row)]))
    const identities = await loadFranchiseIdentities(connection)
    const matches = matchContactsToFranchises(parsed.contacts, identities)

    const touched: string[] = []
    let matched = 0
    let refreshed = 0
    let needsReview = 0
    let unmatched = 0
    let keptManual = 0

    for (const profile of profiles.values()) {
      if (profile.source === "manual") {
        keptManual += 1
        continue
      }
      const contact = profile.bukkuContactCode ? contactsByCode.get(profile.bukkuContactCode) : undefined
      if (contact) {
        await writeProfile(connection, profile.franchiseId, contactSnapshot(contact), "bukku", profile.matchStatus, userId)
        touched.push(profile.franchiseId)
        refreshed += 1
      }
    }

    for (const match of matches) {
      if (profiles.has(match.franchiseId)) {
        continue
      }
      if (match.status === "matched") {
        const contact = contactsByCode.get(match.contactCode)
        if (contact) {
          await writeProfile(connection, match.franchiseId, contactSnapshot(contact), "bukku", "auto", userId)
          touched.push(match.franchiseId)
          matched += 1
        }
      } else if (match.status === "ambiguous") {
        needsReview += 1
      } else {
        unmatched += 1
      }
    }

    await refreshOpenDocuments(touched, connection)
    return { matched, refreshed, needsReview, unmatched, keptManual }
  })

  return { batchId, contacts: parsed.contacts.length, skipped: parsed.skipped, ...outcome }
}

/** A problem with the uploaded file itself, shown to the person as is. */
export class ImportError extends Error {}

/**
 * Every franchise in the renewal book with its profile, or with the
 * candidate contacts the matcher found when it has none.
 */
export async function listBillingProfiles(db: Queryable = getPool()): Promise<{
  rows: BillingProfileRow[]
  contactCount: number
  lastImportedAt: string | null
}> {
  const [franchiseRows] = await db.query<RowDataPacket[]>(
    `SELECT s.franchise_id, MAX(s.company_name) AS company_name, COUNT(*) AS outlet_count
       FROM outlet_subscriptions s
      WHERE s.deleted_at IS NULL
      GROUP BY s.franchise_id
      ORDER BY company_name ASC, s.franchise_id ASC`
  )
  const [profileRows] = await db.query<ProfileRow[]>(`SELECT ${PROFILE_COLUMNS} FROM renewal_billing_profiles`)
  const [importRows] = await db.query<RowDataPacket[]>(
    `SELECT COUNT(*) AS contact_count, MAX(imported_at) AS last_imported_at FROM renewal_bukku_contacts`
  )
  const profiles = new Map(profileRows.map((row) => [row.franchise_id, mapProfile(row)]))
  const contactCount = Number((importRows[0] as { contact_count?: number } | undefined)?.contact_count ?? 0)

  // Candidates are worked out now rather than stored, so they always reflect
  // the latest import and the franchise's current names and emails.
  let matches = new Map<string, ContactMatch>()
  let contacts = new Map<string, BukkuContact>()
  const unprofiled = franchiseRows.some((row) => !profiles.has(String(row.franchise_id)))
  if (contactCount > 0 && unprofiled) {
    const allContacts = await loadContacts(db)
    contacts = new Map(allContacts.map((contact) => [contact.contactCode, contact]))
    const identities = (await loadFranchiseIdentities(db)).filter((identity) => !profiles.has(identity.franchiseId))
    matches = new Map(matchContactsToFranchises(allContacts, identities).map((match) => [match.franchiseId, match]))
  }

  const rows = (franchiseRows as Array<Record<string, string | number | null>>).map((row) => {
    const franchiseId = String(row.franchise_id)
    const match = matches.get(franchiseId)
    const codes = match?.status === "ambiguous" ? match.candidates : match?.status === "matched" ? [match.contactCode] : []
    return {
      franchiseId,
      companyName: row.company_name === null ? null : String(row.company_name),
      outletCount: Number(row.outlet_count),
      profile: profiles.get(franchiseId) ?? null,
      candidates: codes
        .map((code) => contacts.get(code))
        .filter((contact): contact is BukkuContact => Boolean(contact))
        .map((contact) => ({
          contactCode: contact.contactCode,
          legalName: contact.legalName,
          registrationNo: contact.registrationNo,
          tin: contact.tin,
        })),
    }
  })

  return {
    rows,
    contactCount,
    lastImportedAt: (importRows[0] as { last_imported_at?: string | null } | undefined)?.last_imported_at ?? null,
  }
}

/** Search the imported contacts by code, name or registration number, for the picker. */
export async function searchBukkuContacts(
  query: string,
  db: Queryable = getPool()
): Promise<Array<{ contactCode: string; legalName: string; otherName: string | null; registrationNo: string | null; tin: string | null }>> {
  const term = `%${query.trim().replace(/[\\%_]/g, (match) => `\\${match}`)}%`
  const [rows] = await db.query<ContactRow[]>(
    `SELECT contact_code, legal_name, other_name, registration_no, tin
       FROM renewal_bukku_contacts
      WHERE contact_code LIKE ? OR legal_name LIKE ? OR other_name LIKE ? OR registration_no LIKE ?
      ORDER BY legal_name ASC
      LIMIT 20`,
    [term, term, term, term]
  )
  return rows.map((row) => ({
    contactCode: row.contact_code,
    legalName: row.legal_name,
    otherName: row.other_name,
    registrationNo: row.registration_no,
    tin: row.tin,
  }))
}

export type SaveProfileOutcome =
  | { ok: true; profile: BillingProfile; documentsRefreshed: number }
  | { ok: false; status: number; message: string }

/** Link a franchise to a Bukku contact, copying its details. A person chose it, so it is confirmed. */
export async function linkBukkuContact(
  franchiseId: string,
  contactCode: string,
  userId: string | null
): Promise<SaveProfileOutcome> {
  const [contact] = await loadContacts(getPool(), [contactCode])
  if (!contact) {
    return { ok: false, status: 404, message: `No imported Bukku contact has the code ${contactCode}.` }
  }
  return saveAndRefresh(franchiseId, contactSnapshot(contact), "bukku", "confirmed", userId)
}

/**
 * Save details typed in by staff. The profile is marked manual so later
 * imports leave it alone; the Bukku contact code, if given, is kept for the
 * export.
 */
export async function saveManualProfile(
  franchiseId: string,
  input: BillingProfileInput & { bukkuContactCode: string | null },
  userId: string | null
): Promise<SaveProfileOutcome> {
  return saveAndRefresh(franchiseId, input, "manual", "manual", userId)
}

/** Accept the importer's automatic match as correct. */
export async function confirmProfile(franchiseId: string, userId: string | null): Promise<SaveProfileOutcome> {
  const profile = await loadBillingProfile(franchiseId)
  if (!profile) {
    return { ok: false, status: 404, message: "This franchise has no billing profile to confirm." }
  }
  return saveAndRefresh(franchiseId, snapshotOf(profile), profile.source, profile.source === "manual" ? "manual" : "confirmed", userId)
}

/** Remove the profile; open documents go back to the company name alone. */
export async function deleteBillingProfile(franchiseId: string): Promise<number> {
  return withTransaction(async (connection) => {
    await connection.query<ResultSetHeader>(`DELETE FROM renewal_billing_profiles WHERE franchise_id = ?`, [franchiseId])
    return refreshOpenDocuments([franchiseId], connection)
  })
}

async function saveAndRefresh(
  franchiseId: string,
  snapshot: BillToSnapshot,
  source: BillingProfile["source"],
  matchStatus: BillingProfile["matchStatus"],
  userId: string | null
): Promise<SaveProfileOutcome> {
  const documentsRefreshed = await withTransaction(async (connection) => {
    await writeProfile(connection, franchiseId, snapshot, source, matchStatus, userId)
    return refreshOpenDocuments([franchiseId], connection)
  })
  const profile = await loadBillingProfile(franchiseId)
  if (!profile) {
    return { ok: false, status: 500, message: "The profile was not saved." }
  }
  return { ok: true, profile, documentsRefreshed }
}
