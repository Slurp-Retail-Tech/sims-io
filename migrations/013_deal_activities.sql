-- =============================================================================
-- Migration: 013_deal_activities.sql
-- Target DB: sims-staging-platform / production (MySQL 8.0)
-- Run as:    mysql -u user -p <database> < migrations/013_deal_activities.sql
--
-- Purpose:
--   Add an append-only audit log for deals. Records deal creation and every
--   stage transition (from_stage -> to_stage, by whom, when). Surfaced on the
--   new deal detail page (/sales/deals/[dealId]).
--
-- Column signedness:
--   The live `deals.id` and `users.id` are signed `BIGINT` (the schema.sql
--   declarations are `BIGINT UNSIGNED`, but production drifted). FK columns must
--   match the referenced column's signedness exactly, so deal_id and
--   created_by_user_id below are signed `BIGINT` (NOT UNSIGNED), consistent with
--   migration 011 which created the deals / lead_activities tables.
--
-- Idempotency:
--   Uses CREATE TABLE IF NOT EXISTS, so it is safe to re-run.
-- =============================================================================

CREATE TABLE IF NOT EXISTS deal_activities (
  id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  deal_id BIGINT NOT NULL,
  activity_type ENUM('created', 'stage_changed') NOT NULL,
  from_stage ENUM(
    'To Qualify',
    'Demo Scheduled',
    'Quotation Sent',
    'Closed Won',
    'Closed Lost'
  ) DEFAULT NULL,
  to_stage ENUM(
    'To Qualify',
    'Demo Scheduled',
    'Quotation Sent',
    'Closed Won',
    'Closed Lost'
  ) DEFAULT NULL,
  created_by_user_id BIGINT DEFAULT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  CONSTRAINT fk_deal_activities_deal_id
    FOREIGN KEY (deal_id) REFERENCES deals(id) ON DELETE CASCADE,
  CONSTRAINT fk_deal_activities_created_by
    FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE SET NULL,
  INDEX deal_activities_deal_idx (deal_id, created_at)
);
