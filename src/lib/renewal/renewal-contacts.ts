/**
 * The database half of renewal contact designation.
 *
 * Decisions live in `pic-resolution.ts`, which is pure and tested. This file
 * loads the rows resolution needs, and writes the two designations and the
 * channel list.
 *
 * "Exactly one renewal PIC per outlet" cannot be a unique constraint. It spans
 * outlet-specific and franchise-wide mappings, and MySQL does not treat
 * `outlet_id` NULL as a distinct value — NULL is precisely what encodes "every
 * outlet under this franchise". So it is enforced here, in a transaction,
 * behind the same per-franchise row lock the assignment writer uses.
 *
 * The slot is `(franchise_id, outlet_id)` exactly, NULL included as its own
 * slot. An outlet-specific PIC and a franchise-wide PIC coexisting is valid and
 * expected: the outlet-specific one wins at resolution, exactly as an
 * outlet-scope plan assignment beats a franchise-scope one.
 */

import getPool, { withTransaction, type Queryable } from "../db.ts"
import type { PoolConnection, ResultSetHeader, RowDataPacket } from "mysql2/promise"

import type {
  Channel,
  RenewalContact,
  RenewalMapping,
} from "./pic-resolution.ts"

type MappingRow = RowDataPacket & {
  mapping_id: string
  contact_id: string
  franchise_id: string
  outlet_id: string | null
  is_renewal_pic: number
  is_renewal_cc: number
  name: string
  email: string | null
  primary_phone: string | null
}

type ChannelRow = RowDataPacket & {
  contact_id: string
  channel: Channel
  is_enabled: number
  respondio_contact_id: string | null
}

export type RenewalDirectory = {
  mappings: RenewalMapping[]
  contacts: Map<string, RenewalContact>
}

/**
 * Load every renewal-relevant mapping under a franchise, with the contacts and
 * channels resolution needs.
 *
 * Deliberately loads both designated and undesignated mappings: a contact
 * mapped to the outlet but designated neither PIC nor CC receives nothing, and
 * resolution needs to see that rather than infer it from an absence.
 *
 * Soft-deleted contacts are excluded — a deleted contact is not somebody to
 * address an invoice to.
 */
export async function loadRenewalDirectory(
  franchiseId: string,
  db: Queryable = getPool()
): Promise<RenewalDirectory> {
  const [rows] = await db.query<MappingRow[]>(
    `
    SELECT co.id AS mapping_id, co.contact_id, co.franchise_id, co.outlet_id,
           co.is_renewal_pic, co.is_renewal_cc,
           c.name, c.email,
           (SELECT p.phone FROM contact_phone_numbers p
             WHERE p.contact_id = c.id
             ORDER BY p.is_primary DESC, p.id ASC LIMIT 1) AS primary_phone
      FROM contact_outlets co
      INNER JOIN contacts c ON c.id = co.contact_id AND c.deleted_at IS NULL
     WHERE co.franchise_id = ?
     ORDER BY co.outlet_id IS NULL DESC, co.outlet_id ASC, co.id ASC
    `,
    [franchiseId]
  )

  const contactIds = [...new Set(rows.map((row) => String(row.contact_id)))]
  const channels = await loadChannels(contactIds, db)

  const mappings: RenewalMapping[] = rows.map((row) => ({
    contactId: String(row.contact_id),
    franchiseId: row.franchise_id,
    outletId: row.outlet_id,
    isRenewalPic: row.is_renewal_pic === 1,
    isRenewalCc: row.is_renewal_cc === 1,
  }))

  const contacts = new Map<string, RenewalContact>()
  for (const row of rows) {
    const contactId = String(row.contact_id)
    if (contacts.has(contactId)) {
      continue
    }
    contacts.set(contactId, {
      contactId,
      name: row.name,
      email: row.email,
      primaryPhone: row.primary_phone,
      channels: channels.get(contactId) ?? [],
    })
  }

  return { mappings, contacts }
}

async function loadChannels(
  contactIds: readonly string[],
  db: Queryable
): Promise<Map<string, RenewalContact["channels"]>> {
  const byContact = new Map<string, RenewalContact["channels"]>()
  if (contactIds.length === 0) {
    return byContact
  }

  const [rows] = await db.query<ChannelRow[]>(
    `SELECT contact_id, channel, is_enabled, respondio_contact_id
       FROM contact_channels
      WHERE contact_id IN (${contactIds.map(() => "?").join(", ")})`,
    [...contactIds]
  )

  for (const row of rows) {
    const contactId = String(row.contact_id)
    const list = byContact.get(contactId) ?? []
    list.push({ channel: row.channel, isEnabled: row.is_enabled === 1 })
    byContact.set(contactId, list)
  }

  return byContact
}

export type DesignationResult =
  | { ok: true }
  | { ok: false; reason: "mapping_not_found" }
  /** Another contact already holds the PIC slot for this exact scope. */
  | {
      ok: false
      reason: "pic_taken"
      existingContactId: string
      existingContactName: string
    }

/**
 * Designate a mapping as renewal PIC, CC, both, or neither.
 *
 * Refuses rather than silently moving the designation when another contact
 * already holds the PIC slot for the same `(franchise_id, outlet_id)`. The
 * error names them, because "someone else is already the PIC" is unactionable
 * without knowing who.
 *
 * CC carries no such rule: any number of contacts may be copied, including
 * none.
 */
export async function setRenewalDesignation(
  mappingId: string,
  designation: { isRenewalPic: boolean; isRenewalCc: boolean }
): Promise<DesignationResult> {
  return withTransaction(async (connection) => {
    const [rows] = await connection.query<RowDataPacket[]>(
      `SELECT id, contact_id, franchise_id, outlet_id
         FROM contact_outlets WHERE id = ?`,
      [mappingId]
    )
    const mapping = rows[0] as
      | {
          id: string
          contact_id: string
          franchise_id: string
          outlet_id: string | null
        }
      | undefined

    if (!mapping) {
      return { ok: false as const, reason: "mapping_not_found" as const }
    }

    await lockFranchise(connection, mapping.franchise_id)

    if (designation.isRenewalPic) {
      // NULL-safe equality: `outlet_id <=> NULL` matches the franchise-wide
      // slot, which `= NULL` never would.
      const [clash] = await connection.query<RowDataPacket[]>(
        `SELECT co.id, co.contact_id, c.name
           FROM contact_outlets co
           INNER JOIN contacts c ON c.id = co.contact_id AND c.deleted_at IS NULL
          WHERE co.franchise_id = ? AND co.outlet_id <=> ?
            AND co.is_renewal_pic = 1 AND co.id <> ?
          LIMIT 1
          FOR UPDATE`,
        [mapping.franchise_id, mapping.outlet_id, mappingId]
      )

      const taken = clash[0] as
        | { id: string; contact_id: string; name: string }
        | undefined

      if (taken) {
        return {
          ok: false as const,
          reason: "pic_taken" as const,
          existingContactId: String(taken.contact_id),
          existingContactName: taken.name,
        }
      }
    }

    await connection.query<ResultSetHeader>(
      `UPDATE contact_outlets
          SET is_renewal_pic = ?, is_renewal_cc = ?
        WHERE id = ?`,
      [
        designation.isRenewalPic ? 1 : 0,
        designation.isRenewalCc ? 1 : 0,
        mappingId,
      ]
    )

    return { ok: true as const }
  })
}

/**
 * Replace a contact's channel list.
 *
 * A channel absent from the list is removed rather than left disabled, so the
 * table says what the contact asked for rather than accumulating every choice
 * they have ever made.
 */
export async function setContactChannels(
  contactId: string,
  channels: ReadonlyArray<{ channel: Channel; isEnabled: boolean }>
): Promise<void> {
  await withTransaction(async (connection) => {
    const keep = channels.map((entry) => entry.channel)

    if (keep.length === 0) {
      await connection.query<ResultSetHeader>(
        `DELETE FROM contact_channels WHERE contact_id = ?`,
        [contactId]
      )
      return
    }

    await connection.query<ResultSetHeader>(
      `DELETE FROM contact_channels
        WHERE contact_id = ? AND channel NOT IN (${keep.map(() => "?").join(", ")})`,
      [contactId, ...keep]
    )

    for (const entry of channels) {
      await connection.query<ResultSetHeader>(
        `INSERT INTO contact_channels (contact_id, channel, is_enabled)
         VALUES (?, ?, ?)
         ON DUPLICATE KEY UPDATE is_enabled = VALUES(is_enabled)`,
        [contactId, entry.channel, entry.isEnabled ? 1 : 0]
      )
    }
  })
}

/** A contact's channels, for the Contacts UI. */
export async function loadContactChannels(
  contactId: string,
  db: Queryable = getPool()
): Promise<Array<{ channel: Channel; isEnabled: boolean }>> {
  const [rows] = await db.query<ChannelRow[]>(
    `SELECT contact_id, channel, is_enabled, respondio_contact_id
       FROM contact_channels WHERE contact_id = ? ORDER BY channel ASC`,
    [contactId]
  )
  return rows.map((row) => ({
    channel: row.channel,
    isEnabled: row.is_enabled === 1,
  }))
}

/** Cache the Respond.io contact id resolved for one channel. */
export async function recordRespondioContactId(
  contactId: string,
  channel: Channel,
  respondioContactId: string,
  db: Queryable = getPool()
): Promise<void> {
  await db.query<ResultSetHeader>(
    `UPDATE contact_channels
        SET respondio_contact_id = ?
      WHERE contact_id = ? AND channel = ?`,
    [respondioContactId, contactId, channel]
  )
}

/**
 * The franchise settings row as a per-franchise mutex, upserted so there is
 * always something to lock. Same trick as the assignment writer, and as
 * `withContactLock` plays with the contact row.
 */
async function lockFranchise(
  connection: PoolConnection,
  franchiseId: string
): Promise<void> {
  await connection.query<ResultSetHeader>(
    `INSERT INTO renewal_franchise_settings (franchise_id)
     VALUES (?)
     ON DUPLICATE KEY UPDATE franchise_id = VALUES(franchise_id)`,
    [franchiseId]
  )
  await connection.query<RowDataPacket[]>(
    `SELECT id FROM renewal_franchise_settings WHERE franchise_id = ? FOR UPDATE`,
    [franchiseId]
  )
}
