-- =============================================================================
-- Migration: 016_deal_close_lost_remarks.sql
-- Target DB: sims-staging-platform / production (MySQL 8.0)
-- Run as:    mysql -u user -p <database> < migrations/016_deal_close_lost_remarks.sql
--
-- Purpose:
--   Let sales capture free-text context when a deal is marked "Closed Lost", in
--   addition to the fixed close_lost_reason enum. Adds an optional TEXT column
--   deals.close_lost_remarks. NULL means no remarks were recorded, and the
--   column is cleared whenever the deal moves off the "Closed Lost" stage.
--
-- Idempotency:
--   FORWARD-ONLY. The ADD COLUMN statement errors if re-run on a DB that already
--   has the column (consistent with migrations 005-009, 011, 012, 014, 015).
-- =============================================================================

ALTER TABLE deals
  ADD COLUMN close_lost_remarks TEXT DEFAULT NULL AFTER close_lost_reason;
