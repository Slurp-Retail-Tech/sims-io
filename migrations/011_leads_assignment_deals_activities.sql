-- =============================================================================
-- Migration: 011_leads_assignment_deals_activities.sql
-- Target DB: sims-staging-platform / production (MySQL 8.0)
-- Run as:    mysql -u user -p <database> < migrations/011_leads_assignment_deals_activities.sql
--
-- Purpose:
--   Adds the CRM lifecycle introduced by the Leads Management Enhancement and
--   the Dedicated Deals Page:
--     1. lead assignment        — leads.assigned_user_id (FK -> users)
--     2. lead source relabel     — backfill legacy 'desktop'/'demo-form' to 'web'
--     3. deals                   — one or more deals (packages) per lead
--     4. lead_activities         — activity log (notes, calls, meetings, ...)
--
-- Column types:
--   The live `leads.id` and `users.id` are signed `BIGINT` (the schema.sql
--   snapshot declares them UNSIGNED, but the deployed databases drifted to
--   signed). MySQL requires foreign-key columns to match the referenced
--   column's signedness exactly, so every new id / FK column below is signed
--   `BIGINT` (NOT UNSIGNED) to match the live tables.
--
-- Idempotency:
--   FORWARD-ONLY. The ADD COLUMN / ADD CONSTRAINT statements error if re-run on
--   a DB that already has them (consistent with migrations 005-009). The two
--   new tables use CREATE TABLE IF NOT EXISTS. The source backfill UPDATE is
--   naturally idempotent (re-running matches nothing new).
-- =============================================================================

-- 1. Lead assignment ---------------------------------------------------------
ALTER TABLE leads
  ADD COLUMN assigned_user_id BIGINT DEFAULT NULL AFTER source,
  ADD CONSTRAINT fk_leads_assigned_user_id
    FOREIGN KEY (assigned_user_id) REFERENCES users(id) ON DELETE SET NULL,
  ADD INDEX leads_assigned_user_idx (assigned_user_id, created_at);

-- 2. Source relabel (web | mobile | manual) ----------------------------------
--   The web demo form previously wrote 'desktop' and the API default was
--   'demo-form'. Both now map to 'web'. 'mobile' (WhatsApp form) is unchanged,
--   and 'manual' is only ever written by the authenticated manual-create path.
UPDATE leads SET source = 'web' WHERE source IN ('desktop', 'demo-form');

-- 3. Deals -------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS deals (
  id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  lead_id BIGINT NOT NULL,
  deal_name VARCHAR(255) NOT NULL,
  deal_stage ENUM(
    'To Qualify',
    'Demo Scheduled',
    'Quotation Sent',
    'Closed Won',
    'Closed Lost'
  ) NOT NULL DEFAULT 'To Qualify',
  amount DECIMAL(12, 2) NOT NULL DEFAULT 0,
  closed_date DATE DEFAULT NULL,
  close_lost_reason ENUM(
    'Unreachable Contact',
    'Low Budget',
    'Using Current POS',
    'Product Unfit',
    'Wrong Target Audience',
    'Delivery Integration',
    'Inventory',
    'KDS',
    'Disqualify'
  ) DEFAULT NULL,
  created_by_user_id BIGINT DEFAULT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  CONSTRAINT fk_deals_lead_id
    FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE CASCADE,
  CONSTRAINT fk_deals_created_by
    FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE SET NULL,
  INDEX deals_lead_idx (lead_id, created_at),
  INDEX deals_stage_idx (deal_stage, created_at)
);

-- 4. Lead activities ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS lead_activities (
  id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  lead_id BIGINT NOT NULL,
  activity_type ENUM(
    'Note',
    'Email',
    'Call',
    'Task',
    'Meeting',
    'WhatsApp Message'
  ) NOT NULL,
  activity_date DATETIME(3) DEFAULT NULL,
  remarks TEXT DEFAULT NULL,
  call_outcome ENUM(
    'Busy',
    'Connected',
    'Left Live Message',
    'Left Voicemail',
    'No Answer',
    'Wrong Number'
  ) DEFAULT NULL,
  call_direction ENUM('Inbound', 'Outbound') DEFAULT NULL,
  meeting_outcome ENUM(
    'Scheduled',
    'Completed',
    'Rescheduled',
    'No Show',
    'Canceled'
  ) DEFAULT NULL,
  location_type ENUM('Online', 'Onsite') DEFAULT NULL,
  location VARCHAR(255) DEFAULT NULL,
  created_by_user_id BIGINT DEFAULT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  CONSTRAINT fk_lead_activities_lead_id
    FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE CASCADE,
  CONSTRAINT fk_lead_activities_created_by
    FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE SET NULL,
  INDEX lead_activities_lead_idx (lead_id, created_at),
  INDEX lead_activities_type_idx (lead_id, activity_type, created_at)
);
