-- =============================================================================
-- Migration: 008_csat_google_review.sql
-- Target DB: sims-platform (MySQL 8.x)
--
-- Purpose:
--   Add the Google Review funnel columns to csat_responses. A qualifying CSAT
--   survey (Support Service rating of Satisfied/Very Satisfied) surfaces a public
--   Google Review link for Slurp Retail Tech Sdn Bhd; these columns record when
--   the link was shown and when it was clicked.
--
-- Notes:
--   MySQL DDL auto-commits, so take a database backup immediately before running.
--   Idempotent — guarded by information_schema checks.
-- =============================================================================

DROP PROCEDURE IF EXISTS _add_csat_google_review_columns;

DELIMITER $$

CREATE PROCEDURE _add_csat_google_review_columns()
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'csat_responses'
      AND COLUMN_NAME = 'google_review_shown_at'
  ) THEN
    ALTER TABLE csat_responses
      ADD COLUMN google_review_shown_at DATETIME(3) DEFAULT NULL AFTER submitted_at;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'csat_responses'
      AND COLUMN_NAME = 'google_review_clicked_at'
  ) THEN
    ALTER TABLE csat_responses
      ADD COLUMN google_review_clicked_at DATETIME(3) DEFAULT NULL AFTER google_review_shown_at;
  END IF;
END$$

DELIMITER ;

CALL _add_csat_google_review_columns();
DROP PROCEDURE IF EXISTS _add_csat_google_review_columns;
