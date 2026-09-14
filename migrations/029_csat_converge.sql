-- =============================================================================
-- Migration: 029_csat_converge.sql
-- Target DB: sims-platform (MySQL 8.x)
--
-- Purpose:
--   Bring the live CSAT tables up to the shape schema.sql has declared since
--   the April 2026 remediation, and stop storing survey tokens in plaintext.
--
-- Why this is remediation, not cleanup:
--   The April report records SIMS-05 ("CSAT tokens stored as plaintext") as
--   REMEDIATED. That was true of schema.sql only — no migration ever altered
--   the live tables. A production survey on 2026-08-29 confirmed csat_tokens
--   still has `token VARCHAR(255)` and no `token_hash` column at all, and
--   src/lib/csat-schema.ts silently selects the plaintext path when it probes.
--   So live survey tokens are readable by anyone who can read the table.
--
-- Additive only. Nothing is dropped here:
--   `token` stays, still populated, so a rollback to the previous release keeps
--   working and no in-flight survey link breaks. Dropping it is migration 030,
--   which must not ship until at least one full token TTL (TOKEN_TTL_DAYS = 3,
--   see src/lib/csat-link.ts) after this is live, so every plaintext-only token
--   has expired.
--
-- Idempotent: every statement is guarded on information_schema, following the
-- same temporary-procedure idiom as 003.
-- =============================================================================

DROP PROCEDURE IF EXISTS _csat_converge;

DELIMITER $$

CREATE PROCEDURE _csat_converge()
BEGIN
  -- ---------------------------------------------------------------------
  -- 1. Legacy reference column: request_id -> ticket_id.
  --    Production already uses ticket_id (confirmed 2026-08-29), so this is
  --    a no-op there. It exists for any database still on the older shape.
  -- ---------------------------------------------------------------------
  IF EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'csat_tokens' AND COLUMN_NAME = 'request_id'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'csat_tokens' AND COLUMN_NAME = 'ticket_id'
  ) THEN
    ALTER TABLE csat_tokens CHANGE COLUMN request_id ticket_id BIGINT NOT NULL;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'csat_responses' AND COLUMN_NAME = 'request_id'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'csat_responses' AND COLUMN_NAME = 'ticket_id'
  ) THEN
    ALTER TABLE csat_responses CHANGE COLUMN request_id ticket_id BIGINT NOT NULL;
  END IF;

  -- ---------------------------------------------------------------------
  -- 2. Add token_hash alongside the plaintext column.
  --    Nullable and un-indexed for now: the backfill below populates it, and
  --    030 makes it NOT NULL + UNIQUE once `token` is gone. Adding the unique
  --    index here would fail on any row the backfill has not reached yet.
  -- ---------------------------------------------------------------------
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'csat_tokens' AND COLUMN_NAME = 'token_hash'
  ) THEN
    ALTER TABLE csat_tokens ADD COLUMN token_hash CHAR(64) NULL AFTER ticket_id;
  END IF;

  -- ---------------------------------------------------------------------
  -- 3. Backfill from plaintext.
  --    SHA2(token, 256) matches hashOpaqueToken() in src/lib/auth.ts, which is
  --    what the application compares against, so existing links keep working.
  -- ---------------------------------------------------------------------
  IF EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'csat_tokens' AND COLUMN_NAME = 'token'
  ) THEN
    UPDATE csat_tokens
       SET token_hash = SHA2(token, 256)
     WHERE token_hash IS NULL
       AND token IS NOT NULL;
  END IF;

  -- ---------------------------------------------------------------------
  -- 4. Non-unique lookup index. The UNIQUE constraint waits for 030: until
  --    `token` is dropped the application may still write through the legacy
  --    path, and a duplicate there would abort this migration instead of
  --    surfacing as an application error.
  -- ---------------------------------------------------------------------
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'csat_tokens' AND INDEX_NAME = 'csat_tokens_token_hash_idx'
  ) THEN
    ALTER TABLE csat_tokens ADD INDEX csat_tokens_token_hash_idx (token_hash);
  END IF;
END$$

DELIMITER ;

CALL _csat_converge();
DROP PROCEDURE IF EXISTS _csat_converge;
