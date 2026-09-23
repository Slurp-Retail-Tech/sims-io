-- 037: company details printed on renewal documents, held in settings.
--
-- The letterhead on every proforma, tax invoice and receipt came from four
-- environment variables (RENEWAL_SELLER_NAME and _LINE_1..3). That meant a
-- redeploy to change an address, and only three lines, which cannot hold a
-- registration number, a full address and contact details together.
--
-- These columns move the details into Renewal Settings. The environment
-- variables stay as a fallback for one release, so an environment that has
-- them set keeps printing the same letterhead until someone fills these in.
--
-- Address and contact are multi-line TEXT, one printed line per line of text.
--
-- Forward-only and idempotent: each ALTER is guarded through
-- information_schema so a re-run is a no-op.

DROP PROCEDURE IF EXISTS _renewal_seller_details;

DELIMITER $$

CREATE PROCEDURE _renewal_seller_details()
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'renewal_settings'
      AND COLUMN_NAME = 'seller_name'
  ) THEN
    ALTER TABLE renewal_settings
      ADD COLUMN seller_name VARCHAR(255) DEFAULT NULL,
      ADD COLUMN seller_registration_no VARCHAR(120) DEFAULT NULL,
      ADD COLUMN seller_address TEXT DEFAULT NULL,
      ADD COLUMN seller_contact TEXT DEFAULT NULL;
  END IF;
END$$

DELIMITER ;

CALL _renewal_seller_details();
DROP PROCEDURE IF EXISTS _renewal_seller_details;
