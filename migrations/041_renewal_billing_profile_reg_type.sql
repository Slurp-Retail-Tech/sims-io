-- 041: the registration number's type on a billing profile.
--
-- Bukku records what a contact's Registration / ID No. is: BRN (an SSM
-- number), NRIC or PASSPORT. Bill To prints it under that label, so a sole
-- proprietor billed by IC number is not shown an "SSM" line.
--
-- Forward-only and idempotent: the ALTER is guarded through
-- information_schema so a re-run is a no-op.

DROP PROCEDURE IF EXISTS _renewal_billing_profile_reg_type;

DELIMITER $$

CREATE PROCEDURE _renewal_billing_profile_reg_type()
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'renewal_billing_profiles'
      AND COLUMN_NAME = 'reg_no_type'
  ) THEN
    ALTER TABLE renewal_billing_profiles
      ADD COLUMN reg_no_type VARCHAR(16) DEFAULT NULL AFTER legal_name;
  END IF;
END$$

DELIMITER ;

CALL _renewal_billing_profile_reg_type();
DROP PROCEDURE IF EXISTS _renewal_billing_profile_reg_type;
