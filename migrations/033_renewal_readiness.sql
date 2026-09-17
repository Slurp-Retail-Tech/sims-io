-- 033: readiness window for the renewal cycle.
--
-- The exact-offset pass (T-15, T-5, T-1) is when invoices are raised. The
-- readiness sweep runs every night over every subscription expiring inside
-- this many days and checks the same eligibility conditions -- plan assigned,
-- PIC designated, PIC reachable -- without raising anything. A gap that would
-- stop the proforma going out is then visible in Actions Required weeks before
-- the offset that needs it, not on the night it is already too late to fix
-- comfortably.
--
-- Forward-only and idempotent. ALTER guarded through information_schema so a
-- re-run is a no-op.

DROP PROCEDURE IF EXISTS _renewal_readiness_window;

DELIMITER $$

CREATE PROCEDURE _renewal_readiness_window()
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'renewal_settings'
      AND COLUMN_NAME = 'readiness_window_days'
  ) THEN
    ALTER TABLE renewal_settings
      ADD COLUMN readiness_window_days INT NOT NULL DEFAULT 30
        AFTER grace_window_days;
  END IF;
END$$

DELIMITER ;

CALL _renewal_readiness_window();
DROP PROCEDURE IF EXISTS _renewal_readiness_window;
