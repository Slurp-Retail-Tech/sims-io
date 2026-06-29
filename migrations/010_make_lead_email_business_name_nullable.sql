-- =============================================================================
-- Migration: 010_make_lead_email_business_name_nullable.sql
-- Target DB: sims-staging-platform / production (MySQL 8.0)
-- Run as:    mysql -u user -p <database> < migrations/010_make_lead_email_business_name_nullable.sql
--
-- Purpose:
--   The demo form no longer collects Email or Business Name, and the lead
--   capture INSERT (src/app/api/leads/route.ts) no longer writes those columns.
--   The live `leads` table still defines them as VARCHAR(255) NOT NULL with no
--   default, so every submission fails with:
--       ERROR 1364 (HY000): Field 'email' doesn't have a default value
--
--   This migration relaxes both columns to nullable (DEFAULT NULL) so inserts
--   that omit them succeed, bringing the live table in line with schema.sql.
--   The columns are RETAINED (not dropped) so historical lead data is preserved.
--
-- Idempotency:
--   MODIFY to the same nullable definition is safe to re-run. The existing
--   leads_email_idx index is unaffected and remains valid on the nullable column.
-- =============================================================================

ALTER TABLE leads
  MODIFY email VARCHAR(255) DEFAULT NULL,
  MODIFY business_name VARCHAR(255) DEFAULT NULL;
