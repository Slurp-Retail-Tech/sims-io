-- =============================================================================
-- Migration: 014_lead_activity_deal_link.sql
-- Target DB: sims-staging-platform / production (MySQL 8.0)
-- Run as:    mysql -u user -p <database> < migrations/014_lead_activity_deal_link.sql
--
-- Purpose:
--   Let a lead activity be attributed to a specific deal on that lead. Adds an
--   optional lead_activities.deal_id pointing at deals(id). NULL means the
--   activity is not tied to any particular deal (the existing behaviour).
--
-- Column signedness:
--   The live `deals.id` is signed `BIGINT` (production drifted from schema.sql's
--   UNSIGNED declaration). The FK column must match the referenced column's
--   signedness exactly, so deal_id below is signed `BIGINT` (NOT UNSIGNED),
--   consistent with migrations 011 and 013.
--
-- ON DELETE SET NULL:
--   Deleting a deal nulls the link rather than removing the activity history.
--
-- Idempotency:
--   FORWARD-ONLY. The ADD COLUMN statement errors if re-run on a DB that already
--   has the column (consistent with migrations 005-009, 011, 012).
-- =============================================================================

ALTER TABLE lead_activities
  ADD COLUMN deal_id BIGINT DEFAULT NULL AFTER lead_id,
  ADD CONSTRAINT fk_lead_activities_deal_id
    FOREIGN KEY (deal_id) REFERENCES deals(id) ON DELETE SET NULL,
  ADD INDEX lead_activities_deal_idx (deal_id);
