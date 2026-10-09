-- 038: a voided or lapsed proforma releases its group key.
--
-- `open_guard` is the unique key that stops two live proformas billing the
-- same group (franchise, expiry, term). It collapsed to NULL only when a row
-- was soft-deleted. Voiding and lapsing change the status and do not delete,
-- so a cancelled or lapsed proforma kept holding the key: the next nightly
-- run lost the insert race to it, "reused" the closed invoice, and the outlet
-- was never invoiced again. The Void dialog has always promised the opposite.
--
-- The guard now also releases on `cancelled`, `superseded` and `lapsed`, the
-- closed-unpaid statuses. A paid proforma keeps its key, so a paid group is
-- never billed twice. Fewer non-NULL values cannot violate the unique index,
-- so existing rows need no clean-up.
--
-- Forward-only and idempotent: guarded on the current generation expression,
-- so a re-run is a no-op.

DROP PROCEDURE IF EXISTS _renewal_release_closed_group_key;

DELIMITER $$

CREATE PROCEDURE _renewal_release_closed_group_key()
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'renewal_invoices'
      AND COLUMN_NAME = 'open_guard'
      AND GENERATION_EXPRESSION LIKE '%lapsed%'
  ) THEN
    ALTER TABLE renewal_invoices
      MODIFY COLUMN open_guard VARCHAR(255)
        GENERATED ALWAYS AS (
          IF(deleted_at IS NULL AND status NOT IN ('cancelled', 'superseded', 'lapsed'),
             CONCAT(group_key, '|', document_type),
             NULL)
        ) STORED;
  END IF;
END$$

DELIMITER ;

CALL _renewal_release_closed_group_key();
DROP PROCEDURE IF EXISTS _renewal_release_closed_group_key;
