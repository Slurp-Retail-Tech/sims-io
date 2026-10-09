-- =============================================================================
-- Migration: 031_renewal_contacts.sql
-- Target DB: sims-platform (MySQL 8.x)
-- Run as:    mysql -u user -p <db> < migrations/031_renewal_contacts.sql
--
-- Purpose:
--   Phase 2 of the renewal lifecycle: who a renewal is addressed to, and how
--   to reach them.
--
--   Reuses the existing Contacts entity rather than introducing a
--   renewal-specific contact table. `contacts`, `contact_phone_numbers` and
--   `contact_outlets` already model a person mapped to many outlets, and
--   `contact_outlets.outlet_id` NULL already means "every outlet under this
--   franchise" -- exactly the scoping renewal needs. What is missing is a way
--   to say which of those contacts is accountable for the renewal, who else
--   should be copied, and which channels each of them actually uses.
--
--   `contacts.respondio_contact_id` already exists (024), so the PRD's request
--   to add it is already satisfied and this migration does not touch it.
--
-- Notes:
--   Two shapes here, so two idempotency techniques:
--
--     - `contact_channels` is a new table: CREATE TABLE IF NOT EXISTS, trivial.
--     - The two flags on `contact_outlets` are ALTERs, which MySQL has no
--       IF NOT EXISTS for. They run inside a guard procedure that checks
--       information_schema first, the pattern established in 003.
--
--   Both flags default to 0, so every existing mapping keeps working
--   unchanged and nobody becomes a renewal PIC by accident.
--
--   "Exactly one renewal PIC per outlet" is NOT a constraint here, and cannot
--   be. It spans outlet-specific and franchise-wide mappings, and MySQL will
--   not treat outlet_id NULL as a distinct value. It is enforced in the
--   application layer inside withContactLock, the same mutex the existing
--   mapping-overlap rules use.
--
--   No foreign key from contact_channels to contacts on the id type boundary
--   is avoided: contacts.id is signed BIGINT in both database shapes (024
--   deliberately matched the deployed users.id drift), so a CASCADE here is
--   safe and worth having -- deleting a contact must not strand its channels.
--
--   Not added to schema.sql; CI baselines that file at 025.
--
-- Rollback:
--   DROP TABLE contact_channels;
--   ALTER TABLE contact_outlets DROP COLUMN is_renewal_pic,
--                               DROP COLUMN is_renewal_cc;
-- =============================================================================

-- -----------------------------------------------------------------------------
-- One row per channel a contact is reachable on.
--
-- Replaces the idea of a single "preferred channel" column, because a contact
-- may want both: a renewal message is dispatched on EVERY channel the contact
-- has enabled, fanning out to one dispatch row per recipient-and-channel pair.
--
-- The Respond.io contact id is stored per channel, not per contact, because
-- Respond.io addresses a contact by identifier -- `phone:{e164}` for WhatsApp,
-- `email:{address}` for email -- and the same person may resolve to different
-- ids on each.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS contact_channels (
  id                   BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  contact_id           BIGINT NOT NULL,

  channel              ENUM('whatsapp','email') NOT NULL,
  is_enabled           TINYINT(1) NOT NULL DEFAULT 1,

  -- Cached from Respond.io's create-or-update call, so a later send skips the
  -- lookup. Nullable: a channel is enabled long before anything is sent on it.
  respondio_contact_id VARCHAR(64) DEFAULT NULL,

  created_at           DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at           DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
                         ON UPDATE CURRENT_TIMESTAMP(3),

  CONSTRAINT fk_contact_channels_contact
    FOREIGN KEY (contact_id) REFERENCES contacts(id) ON DELETE CASCADE,
  UNIQUE KEY contact_channels_contact_channel_uk (contact_id, channel),
  INDEX contact_channels_enabled_idx (contact_id, is_enabled)
);

-- -----------------------------------------------------------------------------
-- Renewal PIC and CC designations on the contact-to-outlet mapping.
--
-- Designated on the MAPPING, not on the contact: the same person may be the
-- renewal PIC for one franchise and merely a support contact for another.
--
-- A CC contact receives the same reminders and receipts as the PIC, on their
-- own channels. It never substitutes for a missing PIC -- an outlet with CC
-- contacts and no PIC still goes to Actions Required, because nobody has been
-- made accountable for the renewal.
-- -----------------------------------------------------------------------------
DROP PROCEDURE IF EXISTS _renewal_contact_flags;

DELIMITER $$

CREATE PROCEDURE _renewal_contact_flags()
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'contact_outlets'
      AND COLUMN_NAME = 'is_renewal_pic'
  ) THEN
    ALTER TABLE contact_outlets
      ADD COLUMN is_renewal_pic TINYINT(1) NOT NULL DEFAULT 0;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'contact_outlets'
      AND COLUMN_NAME = 'is_renewal_cc'
  ) THEN
    ALTER TABLE contact_outlets
      ADD COLUMN is_renewal_cc TINYINT(1) NOT NULL DEFAULT 0;
  END IF;

  -- Resolution reads this: every renewal designation under a franchise, both
  -- scopes at once, with the outlet-specific one preferred in application code.
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'contact_outlets'
      AND INDEX_NAME = 'contact_outlets_renewal_idx'
  ) THEN
    ALTER TABLE contact_outlets
      ADD INDEX contact_outlets_renewal_idx
        (franchise_id, outlet_id, is_renewal_pic, is_renewal_cc);
  END IF;
END$$

DELIMITER ;

CALL _renewal_contact_flags();
DROP PROCEDURE IF EXISTS _renewal_contact_flags;
