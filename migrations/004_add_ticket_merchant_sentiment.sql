-- =============================================================================
-- Migration: 004_add_ticket_merchant_sentiment.sql
-- Target DB: sims-platform (MySQL 8.x)
--
-- Purpose:
--   Add the ticket merchant sentiment column expected by the current app.
--
-- Notes:
--   MySQL DDL auto-commits, so take a database backup immediately before running.
-- =============================================================================

DROP PROCEDURE IF EXISTS _add_ticket_merchant_sentiment;

DELIMITER $$

CREATE PROCEDURE _add_ticket_merchant_sentiment()
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'tickets'
      AND COLUMN_NAME = 'merchant_sentiment'
  ) THEN
    ALTER TABLE tickets
      ADD COLUMN merchant_sentiment VARCHAR(50) DEFAULT NULL AFTER attended_at;
  END IF;
END$$

DELIMITER ;

CALL _add_ticket_merchant_sentiment();
DROP PROCEDURE IF EXISTS _add_ticket_merchant_sentiment;
