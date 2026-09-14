-- =============================================================================
-- Migration: 028_job_runs.sql
-- Target DB: sims-platform (MySQL 8.x)
--
-- Purpose:
--   State for the durable job runner. Replaces three ad-hoc, un-leased job
--   paths (plus-import, merchant-import, clickup-sync) with one
--   claim -> lease -> checkpoint -> complete table, so a job survives a deploy
--   instead of being stranded mid-run with no way to resume or reap it.
--
-- Notes:
--   Deliberately no foreign keys anywhere, including job_run_items -> job_runs.
--   Same reasoning as 027: this sidesteps the BIGINT signedness divergence
--   between schema.sql and production, so these tables are byte-identical in
--   both database shapes. BIGINT UNSIGNED is safe here precisely BECAUSE there
--   are no foreign keys — signedness only has to match across an FK boundary.
--   Referential integrity is enforced in application code; an orphaned item row
--   is harmless and is purged with its run.
--
--   These tables are intentionally NOT added to schema.sql. CI loads schema.sql
--   as the semantic state at 025 and then baselines through 025, so anything
--   added there would make that baseline assert a state that never existed.
--   schema_migrations (027) is absent for the same reason.
--
--   plus_update_jobs and merchant_import_runs are left in place, untouched, as
--   read-only history for the two "last run" widgets. That keeps this migration
--   to pure CREATE TABLE IF NOT EXISTS with no ALTER, which is what makes it
--   trivially idempotent under `verify-idempotent`.
-- =============================================================================

CREATE TABLE IF NOT EXISTS job_runs (
  id                   BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  job_type             VARCHAR(64) NOT NULL,

  -- At most one non-terminal run per (job_type, dedupe_key). MySQL 8 has no
  -- partial indexes, but a UNIQUE index permits unlimited NULLs — so setting
  -- dedupe_key = NULL on completion frees the key while keeping full history.
  -- This is the enqueue-side single-flight guard.
  dedupe_key           VARCHAR(191) DEFAULT NULL,

  status               ENUM('queued','running','succeeded','failed','cancelled')
                         NOT NULL DEFAULT 'queued',
  trigger_source       ENUM('cron','manual','api') NOT NULL DEFAULT 'manual',
  requested_by         VARCHAR(255) DEFAULT NULL,

  params_json          JSON DEFAULT NULL,   -- immutable job input
  cursor_json          JSON DEFAULT NULL,   -- resume checkpoint, handler-shaped
  progress_json        JSON DEFAULT NULL,   -- fixed-size counters, never a list

  total_units          INT UNSIGNED DEFAULT NULL,
  processed_units      INT UNSIGNED NOT NULL DEFAULT 0,

  attempt              INT UNSIGNED NOT NULL DEFAULT 0,
  max_attempts         INT UNSIGNED NOT NULL DEFAULT 5,

  -- Lease. lease_owner is a per-process id: a slice whose fenced UPDATE matches
  -- zero rows knows it was reaped and must abort mid-flight rather than keep
  -- writing on behalf of a run someone else now owns.
  lease_owner          VARCHAR(64) DEFAULT NULL,
  lease_expires_at     DATETIME(3) DEFAULT NULL,
  heartbeat_at         DATETIME(3) DEFAULT NULL,

  -- Backoff gate: a reclaimed run is not eligible again until this passes.
  available_at         DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  error_message        TEXT DEFAULT NULL,

  -- Retained source artifact (the plus-import spreadsheet). The fingerprint
  -- pins the bytes, so a resumed slice cannot silently process a different file
  -- under the same key. artifact_deleted_at makes the reaper's delete
  -- idempotent.
  artifact_key         VARCHAR(512) DEFAULT NULL,
  artifact_fingerprint CHAR(64) DEFAULT NULL,
  artifact_deleted_at  DATETIME(3) DEFAULT NULL,

  created_at           DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  started_at           DATETIME(3) DEFAULT NULL,
  finished_at          DATETIME(3) DEFAULT NULL,
  updated_at           DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
                         ON UPDATE CURRENT_TIMESTAMP(3),

  UNIQUE KEY job_runs_dedupe_idx (job_type, dedupe_key),
  INDEX job_runs_claim_idx (job_type, status, available_at, id),
  INDEX job_runs_lease_idx (status, lease_expires_at),
  INDEX job_runs_artifact_idx (job_type, artifact_deleted_at, finished_at),
  INDEX job_runs_history_idx (job_type, finished_at)
);

CREATE TABLE IF NOT EXISTS job_run_items (
  id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  job_run_id   BIGINT UNSIGNED NOT NULL,

  -- Stable index of the unit within its run (spreadsheet row, POS page, ticket
  -- ordinal). With the UNIQUE below, a replayed slice upserts instead of
  -- duplicating.
  unit_index   INT UNSIGNED NOT NULL,
  unit_key     VARCHAR(191) NOT NULL DEFAULT '',

  outcome      ENUM('updated','skipped','failed','partial') NOT NULL,

  -- Which external phases landed, with their pre-images, e.g.
  -- {"merchant_id":{"state":"applied","previous":"M-1","next":"M-2"},
  --  "category_business":{"state":"failed","previous":17,"next":22}}
  phases_json  JSON DEFAULT NULL,

  message      TEXT DEFAULT NULL,
  created_at   DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  UNIQUE KEY job_run_items_unit_idx (job_run_id, unit_index),
  INDEX job_run_items_outcome_idx (job_run_id, outcome, id)
);
