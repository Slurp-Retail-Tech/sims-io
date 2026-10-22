-- 040: who a renewal document is billed to, as finance knows them in Bukku.
--
-- Bill To printed the POS "company" field, or the merchant's trading name
-- when that was empty, and nothing else. Finance asked for the registered
-- company name and, where the company has them, its SSM and TIN, which is
-- what Bukku already holds per contact.
--
-- renewal_bukku_contacts is the latest Bukku Contacts export, as imported.
-- It is a working copy for matching, keyed by Bukku's own contact code, and
-- a re-import upserts it.
--
-- renewal_billing_profiles is one row per franchise: the Bukku contact it was
-- matched to, and the details printed on its documents. Details are copied
-- from the contact rather than joined, so a profile staff corrected by hand
-- (source = 'manual') survives the next import untouched.
--
-- renewal_invoices.bill_to_json snapshots those details on each document. An
-- open proforma follows its franchise's profile; a paid one, and the tax
-- invoice that settles it, keep what they were printed with.
--
-- renewal_settings gains the Bukku codes the sales-invoice import needs on
-- every line.
--
-- Forward-only and idempotent: CREATE TABLE IF NOT EXISTS, and each ALTER is
-- guarded through information_schema so a re-run is a no-op.

CREATE TABLE IF NOT EXISTS renewal_bukku_contacts (
  contact_code         VARCHAR(64) NOT NULL PRIMARY KEY,
  legal_name           VARCHAR(255) NOT NULL,
  other_name           VARCHAR(255) DEFAULT NULL,
  entity_type          VARCHAR(64) DEFAULT NULL,
  reg_no_type          VARCHAR(16) DEFAULT NULL,
  registration_no      VARCHAR(120) DEFAULT NULL,
  old_registration_no  VARCHAR(120) DEFAULT NULL,
  tin                  VARCHAR(64) DEFAULT NULL,
  sst_no               VARCHAR(64) DEFAULT NULL,
  -- Comma-separated, as Bukku exports them.
  emails               TEXT DEFAULT NULL,
  phones               VARCHAR(255) DEFAULT NULL,
  billing_street       TEXT DEFAULT NULL,
  billing_city         VARCHAR(120) DEFAULT NULL,
  billing_state        VARCHAR(120) DEFAULT NULL,
  billing_postcode     VARCHAR(16) DEFAULT NULL,
  billing_country      VARCHAR(8) DEFAULT NULL,
  import_batch_id      VARCHAR(40) NOT NULL,
  imported_by_user_id  BIGINT DEFAULT NULL,
  imported_at          DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  INDEX renewal_bukku_contacts_name_idx (legal_name)
);

CREATE TABLE IF NOT EXISTS renewal_billing_profiles (
  id                   BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  franchise_id         VARCHAR(120) NOT NULL,
  bukku_contact_code   VARCHAR(64) DEFAULT NULL,
  legal_name           VARCHAR(255) DEFAULT NULL,
  registration_no      VARCHAR(120) DEFAULT NULL,
  old_registration_no  VARCHAR(120) DEFAULT NULL,
  tin                  VARCHAR(64) DEFAULT NULL,
  sst_no               VARCHAR(64) DEFAULT NULL,
  billing_street       TEXT DEFAULT NULL,
  billing_city         VARCHAR(120) DEFAULT NULL,
  billing_state        VARCHAR(120) DEFAULT NULL,
  billing_postcode     VARCHAR(16) DEFAULT NULL,
  billing_country      VARCHAR(8) DEFAULT NULL,
  -- 'bukku': copied from the contact; a re-import refreshes it.
  -- 'manual': edited by staff; a re-import leaves it alone.
  source               ENUM('bukku','manual') NOT NULL DEFAULT 'bukku',
  -- 'auto': the importer found exactly one contact. 'confirmed': a person
  -- picked or accepted it. 'manual': typed in, no Bukku contact behind it.
  match_status         ENUM('auto','confirmed','manual') NOT NULL DEFAULT 'auto',
  updated_by_user_id   BIGINT DEFAULT NULL,
  created_at           DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at           DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
                         ON UPDATE CURRENT_TIMESTAMP(3),

  UNIQUE KEY renewal_billing_profiles_franchise_uk (franchise_id),
  INDEX renewal_billing_profiles_contact_idx (bukku_contact_code)
);

DROP PROCEDURE IF EXISTS _renewal_billing_profiles;

DELIMITER $$

CREATE PROCEDURE _renewal_billing_profiles()
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'renewal_invoices'
      AND COLUMN_NAME = 'bill_to_json'
  ) THEN
    ALTER TABLE renewal_invoices
      ADD COLUMN bill_to_json JSON DEFAULT NULL AFTER company_name;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'renewal_settings'
      AND COLUMN_NAME = 'bukku_account_code'
  ) THEN
    ALTER TABLE renewal_settings
      ADD COLUMN bukku_account_code VARCHAR(32) DEFAULT NULL,
      ADD COLUMN bukku_tax_code VARCHAR(32) DEFAULT NULL,
      ADD COLUMN bukku_classification_code VARCHAR(16) DEFAULT NULL;
  END IF;
END$$

DELIMITER ;

CALL _renewal_billing_profiles();
DROP PROCEDURE IF EXISTS _renewal_billing_profiles;
