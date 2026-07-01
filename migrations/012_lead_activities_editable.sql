-- =============================================================================
-- Migration: 012_lead_activities_editable.sql
-- Target DB: sims-staging-platform / production (MySQL 8.0)
-- Run as:    mysql -u user -p <database> < migrations/012_lead_activities_editable.sql
--
-- Purpose:
--   Make the lead activity log editable. Adds lead_activities.updated_at, set
--   explicitly whenever an activity is edited via PATCH. NULL means the activity
--   has never been edited (mirrors how deals.updated_at is managed).
--
-- Idempotency:
--   FORWARD-ONLY. The ADD COLUMN statement errors if re-run on a DB that already
--   has the column (consistent with migrations 005-009, 011).
-- =============================================================================

ALTER TABLE lead_activities
  ADD COLUMN updated_at DATETIME(3) DEFAULT NULL AFTER created_at;
