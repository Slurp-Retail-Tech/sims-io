-- =============================================================================
-- Migration: 015_add_lead_status.sql
-- Target DB: sims-staging-platform / production (MySQL 8.0)
-- Run as:    mysql -u user -p <database> < migrations/015_add_lead_status.sql
--
-- Purpose:
--   Track whether a lead has been worked yet. Adds leads.status, an ENUM with
--   values 'Unworked' and 'Worked', defaulting to 'Unworked'. All existing rows
--   backfill to 'Unworked' via the DEFAULT applied to the new NOT NULL column.
--
-- Idempotency:
--   FORWARD-ONLY. The ADD COLUMN statement errors if re-run on a DB that already
--   has the column (consistent with migrations 005-009, 011, 012, 014).
-- =============================================================================

ALTER TABLE leads
  ADD COLUMN status ENUM('Unworked', 'Worked') NOT NULL DEFAULT 'Unworked' AFTER source,
  ADD INDEX leads_status_idx (status);
