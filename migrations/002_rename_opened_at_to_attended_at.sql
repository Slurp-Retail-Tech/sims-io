-- =============================================================================
-- Migration: 002_rename_opened_at_to_attended_at.sql
-- Target DB: MySQL 8.x
-- Run as:    mysql -u user -p <db_name> < migrations/002_rename_opened_at_to_attended_at.sql
--
-- Purpose:
--   Rename tickets.opened_at to tickets.attended_at and preserve existing data.
--   The new field represents when an agent explicitly clicks "Attend", rather
--   than defaulting to ticket creation time.
--
-- Idempotency:
--   Safe to run multiple times. All schema changes are guarded through
--   information_schema checks.
-- =============================================================================

DROP PROCEDURE IF EXISTS _rename_opened_at_to_attended_at;

DELIMITER $$

CREATE PROCEDURE _rename_opened_at_to_attended_at()
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'tickets'
      AND COLUMN_NAME = 'opened_at'
  ) AND NOT EXISTS (
    SELECT 1
    FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'tickets'
      AND COLUMN_NAME = 'attended_at'
  ) THEN
    ALTER TABLE tickets
      CHANGE COLUMN opened_at attended_at DATETIME(3) NULL DEFAULT NULL;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'tickets'
      AND INDEX_NAME = 'tickets_status_opened_idx'
  ) THEN
    ALTER TABLE tickets DROP INDEX tickets_status_opened_idx;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'tickets'
      AND INDEX_NAME = 'tickets_status_attended_idx'
  ) THEN
    ALTER TABLE tickets
      ADD INDEX tickets_status_attended_idx (status, attended_at);
  END IF;
END$$

DELIMITER ;

CALL _rename_opened_at_to_attended_at();
DROP PROCEDURE IF EXISTS _rename_opened_at_to_attended_at;
