-- =============================================================================
-- Migration: 017_add_lead_attribution.sql
-- Target DB: sims-staging-platform / production (MySQL 8.0)
-- Run as:    mysql -u user -p <database> < migrations/017_add_lead_attribution.sql
--
-- Purpose:
--   Capture the marketing origin of a lead (Facebook Ads / Google Ads / organic)
--   for demoform submissions. Adds a normalized `origin` display label plus the
--   raw attribution parameters read from the landing URL (utm_source,
--   utm_campaign, gclid, fbclid). All columns are nullable; existing rows stay
--   NULL (origin surfaces as "--"). The existing `referrer` column is unchanged.
--
-- Idempotency:
--   FORWARD-ONLY. The ADD COLUMN statements error if re-run on a DB that already
--   has the columns (consistent with migrations 005-009, 011, 012, 014, 015).
-- =============================================================================

ALTER TABLE leads
  ADD COLUMN origin       VARCHAR(64)  DEFAULT NULL AFTER referrer,
  ADD COLUMN utm_source   VARCHAR(255) DEFAULT NULL AFTER origin,
  ADD COLUMN utm_campaign VARCHAR(255) DEFAULT NULL AFTER utm_source,
  ADD COLUMN gclid        VARCHAR(512) DEFAULT NULL AFTER utm_campaign,
  ADD COLUMN fbclid       VARCHAR(512) DEFAULT NULL AFTER gclid;
