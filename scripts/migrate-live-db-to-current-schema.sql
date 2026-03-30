-- In-place migration for the live legacy schema captured in
-- /Users/hafiz/Downloads/sims-platform.sql.
--
-- Run this against the existing live database after taking a backup.
-- This migration is intentionally additive where possible: it creates the
-- missing tables, adds the columns the current app expects, and backfills
-- merchant data from franchise_cache without dropping legacy columns.
--
-- MySQL DDL auto-commits, so this is not fully transactional.

SET SQL_SAFE_UPDATES = 0;
SET FOREIGN_KEY_CHECKS = 0;

ALTER TABLE users
  MODIFY COLUMN password_hash VARCHAR(255) NULL;

SET @sql = (
  SELECT IF(
    EXISTS(
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = DATABASE()
        AND table_name = 'users'
        AND column_name = 'avatar_url'
    ),
    'SELECT 1',
    'ALTER TABLE users ADD COLUMN avatar_url TEXT DEFAULT NULL AFTER email'
  )
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql = (
  SELECT IF(
    EXISTS(
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = DATABASE()
        AND table_name = 'users'
        AND column_name = 'status'
    ),
    'SELECT 1',
    'ALTER TABLE users ADD COLUMN status ENUM(''pending_activation'', ''active'', ''inactive'') NOT NULL DEFAULT ''pending_activation'' AFTER role'
  )
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql = (
  SELECT IF(
    EXISTS(
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = DATABASE()
        AND table_name = 'users'
        AND column_name = 'page_access'
    ),
    'SELECT 1',
    'ALTER TABLE users ADD COLUMN page_access JSON DEFAULT NULL AFTER password_hash'
  )
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql = (
  SELECT IF(
    EXISTS(
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = DATABASE()
        AND table_name = 'users'
        AND column_name = 'google_subject'
    ),
    'SELECT 1',
    'ALTER TABLE users ADD COLUMN google_subject VARCHAR(255) DEFAULT NULL AFTER page_access'
  )
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql = (
  SELECT IF(
    EXISTS(
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = DATABASE()
        AND table_name = 'users'
        AND column_name = 'google_workspace_domain'
    ),
    'SELECT 1',
    'ALTER TABLE users ADD COLUMN google_workspace_domain VARCHAR(255) DEFAULT NULL AFTER google_subject'
  )
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql = (
  SELECT IF(
    EXISTS(
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = DATABASE()
        AND table_name = 'users'
        AND column_name = 'google_linked_at'
    ),
    'SELECT 1',
    'ALTER TABLE users ADD COLUMN google_linked_at DATETIME(3) DEFAULT NULL AFTER google_workspace_domain'
  )
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql = (
  SELECT IF(
    EXISTS(
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = DATABASE()
        AND table_name = 'users'
        AND column_name = 'invite_sent_at'
    ),
    'SELECT 1',
    'ALTER TABLE users ADD COLUMN invite_sent_at DATETIME(3) DEFAULT NULL AFTER google_linked_at'
  )
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql = (
  SELECT IF(
    EXISTS(
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = DATABASE()
        AND table_name = 'users'
        AND column_name = 'activated_at'
    ),
    'SELECT 1',
    'ALTER TABLE users ADD COLUMN activated_at DATETIME(3) DEFAULT NULL AFTER invite_sent_at'
  )
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql = (
  SELECT IF(
    EXISTS(
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = DATABASE()
        AND table_name = 'users'
        AND column_name = 'password_set_at'
    ),
    'SELECT 1',
    'ALTER TABLE users ADD COLUMN password_set_at DATETIME(3) DEFAULT NULL AFTER activated_at'
  )
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql = (
  SELECT IF(
    EXISTS(
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = DATABASE()
        AND table_name = 'users'
        AND column_name = 'last_login_at'
    ),
    'SELECT 1',
    'ALTER TABLE users ADD COLUMN last_login_at DATETIME(3) DEFAULT NULL AFTER password_set_at'
  )
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql = (
  SELECT IF(
    EXISTS(
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = DATABASE()
        AND table_name = 'users'
        AND column_name = 'updated_at'
    ),
    'SELECT 1',
    'ALTER TABLE users ADD COLUMN updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3) AFTER created_at'
  )
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

UPDATE users
SET
  name = COALESCE(NULLIF(name, ''), SUBSTRING_INDEX(email, '@', 1)),
  department = COALESCE(NULLIF(department, ''), 'Merchant Success'),
  role = COALESCE(NULLIF(role, ''), 'User'),
  status = CASE
    WHEN is_active = 0 THEN 'inactive'
    WHEN password_hash IS NULL OR password_hash = '' THEN 'pending_activation'
    ELSE 'active'
  END,
  activated_at = CASE
    WHEN is_active = 1 THEN COALESCE(activated_at, created_at)
    ELSE activated_at
  END,
  password_set_at = CASE
    WHEN password_hash IS NOT NULL AND password_hash <> '' THEN COALESCE(password_set_at, created_at)
    ELSE password_set_at
  END,
  updated_at = COALESCE(updated_at, created_at);

CREATE TABLE IF NOT EXISTS auth_tokens (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT NOT NULL,
  type ENUM('activation', 'password_reset') NOT NULL,
  token_hash CHAR(64) NOT NULL,
  expires_at DATETIME(3) NOT NULL,
  consumed_at DATETIME(3) DEFAULT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  CONSTRAINT fk_auth_tokens_user_id
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  UNIQUE KEY uniq_auth_token_hash (token_hash),
  INDEX auth_tokens_user_type_idx (user_id, type, expires_at)
);

CREATE TABLE IF NOT EXISTS merchants (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  external_id VARCHAR(120) NOT NULL UNIQUE,
  name VARCHAR(255) NOT NULL,
  fid VARCHAR(120) DEFAULT NULL,
  outlet_count INT NOT NULL DEFAULT 0,
  status VARCHAR(60) DEFAULT NULL,
  raw_payload JSON NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS merchant_import_runs (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  status ENUM('running', 'success', 'failed') NOT NULL,
  started_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at TIMESTAMP NULL DEFAULT NULL,
  records_imported INT NOT NULL DEFAULT 0,
  error_message TEXT DEFAULT NULL
);

CREATE TABLE IF NOT EXISTS merchant_outlets (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  external_id VARCHAR(120) NOT NULL,
  merchant_external_id VARCHAR(120) NOT NULL,
  name VARCHAR(255) NOT NULL,
  status VARCHAR(60) DEFAULT NULL,
  raw_payload JSON NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_merchant_outlet (merchant_external_id, external_id),
  INDEX idx_merchant_outlets_merchant_external_id (merchant_external_id)
);

SET @sql = (
  SELECT IF(
    EXISTS(
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = DATABASE()
        AND table_name = 'plus_update_jobs'
        AND column_name = 'upload_key'
    ),
    'SELECT 1',
    'ALTER TABLE plus_update_jobs ADD COLUMN upload_key VARCHAR(512) DEFAULT NULL AFTER requested_by'
  )
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql = (
  SELECT IF(
    EXISTS(
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = DATABASE()
        AND table_name = 'plus_update_jobs'
        AND column_name = 'updated_count'
    ),
    'SELECT 1',
    'ALTER TABLE plus_update_jobs ADD COLUMN updated_count INT NOT NULL DEFAULT 0 AFTER processed_rows'
  )
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql = (
  SELECT IF(
    EXISTS(
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = DATABASE()
        AND table_name = 'plus_update_jobs'
        AND column_name = 'skipped_count'
    ),
    'SELECT 1',
    'ALTER TABLE plus_update_jobs ADD COLUMN skipped_count INT NOT NULL DEFAULT 0 AFTER updated_count'
  )
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql = (
  SELECT IF(
    EXISTS(
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = DATABASE()
        AND table_name = 'plus_update_jobs'
        AND column_name = 'failed_count'
    ),
    'SELECT 1',
    'ALTER TABLE plus_update_jobs ADD COLUMN failed_count INT NOT NULL DEFAULT 0 AFTER skipped_count'
  )
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

UPDATE plus_update_jobs
SET
  status = CASE
    WHEN status = 'uploaded' THEN 'running'
    ELSE status
  END,
  upload_key = COALESCE(upload_key, template_key),
  updated_count = CASE
    WHEN updated_count = 0 THEN COALESCE(updated_rows, 0)
    ELSE updated_count
  END,
  skipped_count = CASE
    WHEN skipped_count = 0 THEN COALESCE(skipped_rows, 0) + COALESCE(partial_rows, 0)
    ELSE skipped_count
  END,
  failed_count = CASE
    WHEN failed_count = 0 THEN COALESCE(failed_rows, 0)
    ELSE failed_count
  END,
  summary_json = CASE
    WHEN summary_json IS NOT NULL AND preview_json IS NOT NULL THEN
      JSON_MERGE_PATCH(JSON_OBJECT('preview', preview_json), summary_json)
    WHEN summary_json IS NOT NULL THEN summary_json
    WHEN preview_json IS NOT NULL THEN JSON_OBJECT('preview', preview_json)
    ELSE NULL
  END,
  started_at = COALESCE(started_at, created_at);

CREATE TABLE IF NOT EXISTS ticket_categories (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(120) NOT NULL,
  parent_id BIGINT UNSIGNED DEFAULT NULL,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_ticket_categories_parent (parent_id)
);

CREATE TABLE IF NOT EXISTS onboarding_appointments (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  outlet_name VARCHAR(255) NOT NULL,
  installation_type ENUM('Online', 'On-site', 'Support') NOT NULL,
  scheduled_at DATETIME(3) NOT NULL,
  payment_status ENUM('Pending', 'Paid', 'Unpaid') NOT NULL DEFAULT 'Pending',
  status ENUM('Pending', 'Approved', 'Completed') NOT NULL DEFAULT 'Pending',
  created_by_user_id BIGINT UNSIGNED NOT NULL,
  decision_by_user_id BIGINT UNSIGNED DEFAULT NULL,
  decision_at DATETIME(3) DEFAULT NULL,
  decision_reason TEXT DEFAULT NULL,
  assigned_ms_user_id BIGINT UNSIGNED DEFAULT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  INDEX onboarding_appointments_scheduled_idx (scheduled_at),
  INDEX onboarding_appointments_status_created_idx (status, created_at),
  INDEX onboarding_appointments_created_by_idx (created_by_user_id, created_at),
  INDEX onboarding_appointments_assigned_ms_idx (assigned_ms_user_id, scheduled_at)
);

CREATE TABLE IF NOT EXISTS onboarding_appointment_attachments (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  appointment_id BIGINT UNSIGNED NOT NULL,
  storage_key VARCHAR(512) NOT NULL,
  original_name VARCHAR(255) DEFAULT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  CONSTRAINT fk_onboarding_appointment_attachments_appointment_id
    FOREIGN KEY (appointment_id) REFERENCES onboarding_appointments(id) ON DELETE CASCADE,
  INDEX onboarding_appointment_attachments_request_idx (appointment_id, created_at)
);

CREATE TABLE IF NOT EXISTS sales_appointments (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  lead_id BIGINT UNSIGNED DEFAULT NULL,
  customer_name VARCHAR(255) NOT NULL,
  business_name VARCHAR(255) NOT NULL,
  business_type VARCHAR(255) NOT NULL,
  business_location VARCHAR(255) NOT NULL,
  meeting_location VARCHAR(255) DEFAULT NULL,
  appointment_type ENUM('Online', 'Physical') NOT NULL,
  scheduled_at DATETIME(3) NOT NULL,
  status ENUM('Pending', 'Completed', 'Canceled') NOT NULL DEFAULT 'Pending',
  created_by_user_id BIGINT UNSIGNED NOT NULL,
  completed_by_user_id BIGINT UNSIGNED DEFAULT NULL,
  completed_at DATETIME(3) DEFAULT NULL,
  completion_note TEXT DEFAULT NULL,
  canceled_by_user_id BIGINT UNSIGNED DEFAULT NULL,
  canceled_at DATETIME(3) DEFAULT NULL,
  cancel_reason TEXT DEFAULT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  INDEX sales_appointments_scheduled_idx (scheduled_at),
  INDEX sales_appointments_status_created_idx (status, created_at),
  INDEX sales_appointments_created_by_idx (created_by_user_id, created_at),
  INDEX sales_appointments_lead_idx (lead_id, created_at)
);

INSERT INTO merchant_import_runs (
  id,
  status,
  started_at,
  completed_at,
  records_imported,
  error_message
)
SELECT
  legacy.id,
  CASE legacy.status
    WHEN 'completed' THEN 'success'
    WHEN 'failed' THEN 'failed'
    ELSE 'running'
  END,
  legacy.started_at,
  legacy.finished_at,
  COALESCE(legacy.processed_count, 0),
  legacy.error_message
FROM franchise_import_jobs AS legacy
ON DUPLICATE KEY UPDATE
  status = VALUES(status),
  started_at = VALUES(started_at),
  completed_at = VALUES(completed_at),
  records_imported = VALUES(records_imported),
  error_message = VALUES(error_message);

INSERT INTO merchants (
  external_id,
  name,
  fid,
  outlet_count,
  status,
  raw_payload,
  created_at,
  updated_at
)
SELECT
  legacy.merchant_external_id,
  legacy.merchant_name,
  legacy.fid,
  legacy.outlet_count,
  CASE
    WHEN LOWER(COALESCE(JSON_UNQUOTE(JSON_EXTRACT(legacy.franchise_json, '$.closed_account')), 'false')) = 'true' THEN 'Closed'
    WHEN LOWER(COALESCE(JSON_UNQUOTE(JSON_EXTRACT(legacy.franchise_json, '$.test_account')), 'false')) = 'true' THEN 'Test'
    WHEN legacy.is_active = 1 THEN 'Active'
    ELSE 'Inactive'
  END,
  COALESCE(
    legacy.franchise_json,
    JSON_OBJECT(
      'id', legacy.fid,
      'name', legacy.franchise_name,
      'outlets', JSON_ARRAY()
    )
  ),
  legacy.imported_at,
  legacy.imported_at
FROM (
  SELECT
    source.*,
    COALESCE(
      NULLIF(JSON_UNQUOTE(JSON_EXTRACT(source.franchise_json, '$.id')), 'null'),
      source.fid,
      CAST(source.id AS CHAR)
    ) AS merchant_external_id,
    COALESCE(
      NULLIF(JSON_UNQUOTE(JSON_EXTRACT(source.franchise_json, '$.name')), 'null'),
      NULLIF(source.franchise_name, ''),
      CONCAT('Merchant ', source.fid)
    ) AS merchant_name,
    ROW_NUMBER() OVER (
      PARTITION BY source.fid
      ORDER BY source.is_active DESC, source.imported_at DESC, source.id DESC
    ) AS row_num
  FROM franchise_cache AS source
  WHERE source.fid IS NOT NULL
) AS legacy
WHERE legacy.row_num = 1
ON DUPLICATE KEY UPDATE
  name = VALUES(name),
  fid = VALUES(fid),
  outlet_count = VALUES(outlet_count),
  status = VALUES(status),
  raw_payload = VALUES(raw_payload),
  updated_at = CURRENT_TIMESTAMP;

INSERT INTO merchant_outlets (
  external_id,
  merchant_external_id,
  name,
  status,
  raw_payload,
  created_at,
  updated_at
)
SELECT
  COALESCE(
    NULLIF(outlet.outlet_id, ''),
    NULLIF(outlet.oid, ''),
    CONCAT(legacy.fid, '-', outlet.row_num)
  ) AS external_id,
  legacy.merchant_external_id,
  COALESCE(
    NULLIF(outlet.outlet_name, ''),
    NULLIF(outlet.outlet_name_alt, ''),
    CONCAT('Outlet ', COALESCE(outlet.outlet_id, outlet.oid, outlet.row_num))
  ) AS name,
  CASE
    WHEN LOWER(COALESCE(outlet.closed_account, 'false')) = 'true' THEN 'Closed'
    WHEN LOWER(COALESCE(outlet.test_account, 'false')) = 'true' THEN 'Test'
    WHEN legacy.is_active = 1 THEN 'Active'
    ELSE 'Inactive'
  END,
  outlet.raw_payload,
  legacy.imported_at,
  legacy.imported_at
FROM (
  SELECT
    source.*,
    COALESCE(
      NULLIF(JSON_UNQUOTE(JSON_EXTRACT(source.franchise_json, '$.id')), 'null'),
      source.fid,
      CAST(source.id AS CHAR)
    ) AS merchant_external_id,
    ROW_NUMBER() OVER (
      PARTITION BY source.fid
      ORDER BY source.is_active DESC, source.imported_at DESC, source.id DESC
    ) AS row_num
  FROM franchise_cache AS source
  WHERE source.fid IS NOT NULL
) AS legacy
JOIN JSON_TABLE(
  legacy.outlets_json,
  '$[*]' COLUMNS (
    row_num FOR ORDINALITY,
    outlet_id VARCHAR(120) PATH '$.id' NULL ON EMPTY,
    oid VARCHAR(120) PATH '$.oid' NULL ON EMPTY,
    outlet_name VARCHAR(255) PATH '$.name' NULL ON EMPTY,
    outlet_name_alt VARCHAR(255) PATH '$.outlet_name' NULL ON EMPTY,
    closed_account VARCHAR(10) PATH '$.closed_account' NULL ON EMPTY,
    test_account VARCHAR(10) PATH '$.test_account' NULL ON EMPTY,
    raw_payload JSON PATH '$'
  )
) AS outlet
WHERE legacy.row_num = 1
  AND JSON_LENGTH(legacy.outlets_json) > 0
ON DUPLICATE KEY UPDATE
  name = VALUES(name),
  status = VALUES(status),
  raw_payload = VALUES(raw_payload),
  updated_at = CURRENT_TIMESTAMP;

SET FOREIGN_KEY_CHECKS = 1;

-- These indexes are defined last because they can fail if the live data has
-- duplicate values. Run the duplicate checks first if needed.
SET @sql = (
  SELECT IF(
    EXISTS(
      SELECT 1
      FROM information_schema.statistics
      WHERE table_schema = DATABASE()
        AND table_name = 'users'
        AND index_name = 'uniq_users_email'
    ),
    'SELECT 1',
    'ALTER TABLE users ADD UNIQUE KEY uniq_users_email (email)'
  )
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql = (
  SELECT IF(
    EXISTS(
      SELECT 1
      FROM information_schema.statistics
      WHERE table_schema = DATABASE()
        AND table_name = 'users'
        AND index_name = 'uniq_users_google_subject'
    ),
    'SELECT 1',
    'ALTER TABLE users ADD UNIQUE KEY uniq_users_google_subject (google_subject)'
  )
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
