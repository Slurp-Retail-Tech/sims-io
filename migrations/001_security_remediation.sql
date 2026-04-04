-- =============================================================================
-- Migration: 001_security_remediation.sql
-- Target DB: sims-staging-platform (MySQL 8.0)
-- Run as:    mysql -u user -p sims-staging-platform < migrations/001_security_remediation.sql
--
-- Purpose:
--   1. Create the `sessions` table (replaces ad-hoc cookie tokens stored in app
--      memory with a durable, indexed, FK-constrained session store).
--   2. Replace the plaintext `csat_tokens.token` column with `token_hash`
--      (SHA-256 hex digest) so the live DB matches the security-remediated
--      schema.sql.
--
-- Idempotency:
--   All DDL steps are guarded by information_schema checks or IF NOT EXISTS /
--   IF EXISTS clauses. Running this script a second time is safe.
--
-- Note on transactions:
--   MySQL DDL statements (CREATE TABLE, ALTER TABLE, DROP INDEX, etc.) cause an
--   implicit commit and cannot be rolled back. This file therefore does NOT wrap
--   DDL in a transaction. DML (the token_hash backfill UPDATE) is auto-committed
--   as well for simplicity, since backfilling a hash from an existing plaintext
--   column is a purely additive, repeatable operation.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- PART 1: Create `sessions` table
-- ---------------------------------------------------------------------------
-- IF NOT EXISTS makes this step idempotent on re-runs.
-- user_id is signed BIGINT to match users.id (which is signed BIGINT NOT NULL
-- AUTO_INCREMENT in production).  Using UNSIGNED here would cause a type
-- mismatch and prevent the FK from being created.
-- token_hash stores the hex-encoded SHA-256 of the raw session token so the
-- plaintext token is never persisted; only the hash hits disk.

CREATE TABLE IF NOT EXISTS sessions (
  id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  user_id      BIGINT NOT NULL,                  -- signed: mirrors users.id type
  token_hash   CHAR(64) NOT NULL,                -- SHA-256 hex = always 64 chars
  remember     BOOLEAN NOT NULL DEFAULT FALSE,
  expires_at   DATETIME(3) NOT NULL,
  created_at   DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  last_seen_at DATETIME(3) DEFAULT NULL,
  UNIQUE KEY uniq_session_token_hash (token_hash),
  INDEX sessions_user_idx (user_id, expires_at),  -- fast per-user expiry scans
  CONSTRAINT fk_sessions_user_id
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- PART 2: Migrate csat_tokens.token → token_hash
-- ---------------------------------------------------------------------------
-- Background: the live DB stores raw CSAT tokens in plaintext (varchar 255).
-- The remediated schema replaces this with a SHA-256 hash column so that a
-- database read alone cannot be used to forge or replay a CSAT submission.
-- We backfill via MySQL's built-in SHA2(expr, 256) so no application code or
-- external tooling is required for the migration.
--
-- Steps are executed through a stored procedure so we can use IF/THEN
-- conditional logic around each DDL statement, making the whole block
-- idempotent when run more than once.
-- ---------------------------------------------------------------------------

DROP PROCEDURE IF EXISTS _migrate_csat_tokens;

DELIMITER $$

CREATE PROCEDURE _migrate_csat_tokens()
BEGIN

  -- ------------------------------------------------------------------
  -- Step 2a: Add token_hash CHAR(64) NULL if it doesn't already exist.
  -- We add it as nullable first so the column can exist before backfill
  -- without violating NOT NULL on rows that haven't been hashed yet.
  -- ------------------------------------------------------------------
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'csat_tokens'
      AND COLUMN_NAME  = 'token_hash'
  ) THEN
    ALTER TABLE csat_tokens ADD COLUMN token_hash CHAR(64) NULL;
  END IF;

  -- ------------------------------------------------------------------
  -- Step 2b: Backfill token_hash from plaintext token.
  -- Only rows with a NULL token_hash are updated, so re-running is safe
  -- and won't overwrite hashes that were already written.
  -- SHA2(token, 256) produces the lowercase hex SHA-256 digest (64 chars).
  -- ------------------------------------------------------------------
  IF EXISTS (
    SELECT 1
    FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'csat_tokens'
      AND COLUMN_NAME  = 'token'
  ) THEN
    UPDATE csat_tokens
    SET    token_hash = SHA2(token, 256)
    WHERE  token_hash IS NULL;
  END IF;

  -- ------------------------------------------------------------------
  -- Step 2c: Tighten token_hash to NOT NULL now that all rows are hashed.
  -- Only do this while the plaintext `token` column still exists (i.e.,
  -- first run). On subsequent runs token is gone, so this block is skipped
  -- to avoid a redundant ALTER TABLE.
  -- ------------------------------------------------------------------
  IF EXISTS (
    SELECT 1
    FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'csat_tokens'
      AND COLUMN_NAME  = 'token'
  ) THEN
    ALTER TABLE csat_tokens MODIFY COLUMN token_hash CHAR(64) NOT NULL;
  END IF;

  -- ------------------------------------------------------------------
  -- Step 2d: Drop the UNIQUE KEY on the old plaintext `token` column.
  -- Retaining the plaintext index would be misleading after the column
  -- is dropped, and MySQL requires us to drop the index before or at the
  -- same time as the column.
  -- ------------------------------------------------------------------
  IF EXISTS (
    SELECT 1
    FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'csat_tokens'
      AND INDEX_NAME   = 'token'
  ) THEN
    ALTER TABLE csat_tokens DROP INDEX `token`;
  END IF;

  -- ------------------------------------------------------------------
  -- Step 2e: Drop the plaintext token column.
  -- After backfill and index removal, the plaintext column serves no
  -- purpose and presents a security liability.
  -- ------------------------------------------------------------------
  IF EXISTS (
    SELECT 1
    FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'csat_tokens'
      AND COLUMN_NAME  = 'token'
  ) THEN
    ALTER TABLE csat_tokens DROP COLUMN token;
  END IF;

  -- ------------------------------------------------------------------
  -- Step 2f: Add UNIQUE KEY on token_hash if it doesn't already exist.
  -- Ensures one-token-one-row semantics and fast O(1) lookup by hash.
  -- ------------------------------------------------------------------
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'csat_tokens'
      AND INDEX_NAME   = 'uniq_csat_token_hash'
  ) THEN
    ALTER TABLE csat_tokens ADD UNIQUE KEY uniq_csat_token_hash (token_hash);
  END IF;

END$$

DELIMITER ;

-- Execute and immediately clean up the helper procedure.
CALL _migrate_csat_tokens();
DROP PROCEDURE IF EXISTS _migrate_csat_tokens;
