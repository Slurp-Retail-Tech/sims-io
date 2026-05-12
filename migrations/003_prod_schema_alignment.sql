-- =============================================================================
-- Migration: 003_prod_schema_alignment.sql
-- Target DB: sims-platform (MySQL 8.x)
-- Run as:    mysql -u user -p sims-platform < migrations/003_prod_schema_alignment.sql
--
-- Purpose:
--   Align the older production schema with the current application schema.
--   This handles the production baseline observed in sims-platform.sql:
--   - support_requests/support_request_history were renamed to tickets/ticket_history
--   - CSAT request_id columns were renamed to ticket_id
--   - clickup_task_request_attachments.request_id was renamed
--   - the legacy express-session `sessions` table is replaced by app sessions
--   - current auth, merchant, appointment, and ticket-category tables are added
--
-- Notes:
--   MySQL DDL auto-commits, so take a database backup immediately before running.
--   Replacing the legacy sessions table signs users out, which is expected.
-- =============================================================================

DROP PROCEDURE IF EXISTS _prod_schema_alignment;

DELIMITER $$

CREATE PROCEDURE _prod_schema_alignment()
BEGIN
  -- Drop old FK constraints before table/column renames.
  IF EXISTS (
    SELECT 1 FROM information_schema.TABLE_CONSTRAINTS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'support_request_history'
      AND CONSTRAINT_NAME = 'fk_support_request_history_request_id'
  ) THEN
    ALTER TABLE support_request_history DROP FOREIGN KEY fk_support_request_history_request_id;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.TABLE_CONSTRAINTS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'csat_tokens'
      AND CONSTRAINT_NAME = 'fk_csat_tokens_request_id'
  ) THEN
    ALTER TABLE csat_tokens DROP FOREIGN KEY fk_csat_tokens_request_id;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.TABLE_CONSTRAINTS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'csat_responses'
      AND CONSTRAINT_NAME = 'fk_csat_responses_request_id'
  ) THEN
    ALTER TABLE csat_responses DROP FOREIGN KEY fk_csat_responses_request_id;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.TABLE_CONSTRAINTS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'clickup_task_request_attachments'
      AND CONSTRAINT_NAME = 'fk_clickup_task_request_attachments_request_id'
  ) THEN
    ALTER TABLE clickup_task_request_attachments DROP FOREIGN KEY fk_clickup_task_request_attachments_request_id;
  END IF;

  -- Rename old support tables to the names used by the current app.
  IF EXISTS (
    SELECT 1 FROM information_schema.TABLES
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'support_requests'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.TABLES
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'tickets'
  ) THEN
    RENAME TABLE support_requests TO tickets;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.TABLES
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'support_request_history'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.TABLES
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ticket_history'
  ) THEN
    RENAME TABLE support_request_history TO ticket_history;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'ticket_history'
      AND COLUMN_NAME = 'request_id'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'ticket_history'
      AND COLUMN_NAME = 'ticket_id'
  ) THEN
    ALTER TABLE ticket_history CHANGE COLUMN request_id ticket_id BIGINT NOT NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'tickets'
      AND COLUMN_NAME = 'attended_at'
  ) THEN
    ALTER TABLE tickets ADD COLUMN attended_at DATETIME(3) DEFAULT NULL AFTER closed_at;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'tickets'
      AND INDEX_NAME = 'support_requests_status_created_idx'
  ) THEN
    ALTER TABLE tickets DROP INDEX support_requests_status_created_idx;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'tickets'
      AND INDEX_NAME = 'tickets_status_attended_idx'
  ) THEN
    ALTER TABLE tickets ADD INDEX tickets_status_attended_idx (status, attended_at);
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'ticket_history'
      AND INDEX_NAME = 'support_request_history_request_idx'
  ) THEN
    ALTER TABLE ticket_history DROP INDEX support_request_history_request_idx;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'ticket_history'
      AND INDEX_NAME = 'ticket_history_ticket_idx'
  ) THEN
    ALTER TABLE ticket_history ADD INDEX ticket_history_ticket_idx (ticket_id, changed_at);
  END IF;

  -- CSAT table alignment.
  IF EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'csat_tokens'
      AND COLUMN_NAME = 'request_id'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'csat_tokens'
      AND COLUMN_NAME = 'ticket_id'
  ) THEN
    ALTER TABLE csat_tokens CHANGE COLUMN request_id ticket_id BIGINT NOT NULL;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'csat_responses'
      AND COLUMN_NAME = 'request_id'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'csat_responses'
      AND COLUMN_NAME = 'ticket_id'
  ) THEN
    ALTER TABLE csat_responses CHANGE COLUMN request_id ticket_id BIGINT NOT NULL;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'csat_tokens'
      AND INDEX_NAME = 'csat_tokens_request_idx'
  ) THEN
    ALTER TABLE csat_tokens DROP INDEX csat_tokens_request_idx;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'csat_responses'
      AND INDEX_NAME = 'fk_csat_responses_request_id'
  ) THEN
    ALTER TABLE csat_responses DROP INDEX fk_csat_responses_request_id;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'csat_tokens'
      AND INDEX_NAME = 'csat_tokens_ticket_idx'
  ) THEN
    ALTER TABLE csat_tokens ADD INDEX csat_tokens_ticket_idx (ticket_id);
  END IF;

  -- ClickUp attachment table alignment.
  IF EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'clickup_task_request_attachments'
      AND COLUMN_NAME = 'request_id'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'clickup_task_request_attachments'
      AND COLUMN_NAME = 'clickup_task_request_id'
  ) THEN
    ALTER TABLE clickup_task_request_attachments
      CHANGE COLUMN request_id clickup_task_request_id BIGINT NOT NULL;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'clickup_task_request_attachments'
      AND INDEX_NAME = 'clickup_task_request_attachments_request_idx'
  ) THEN
    ALTER TABLE clickup_task_request_attachments DROP INDEX clickup_task_request_attachments_request_idx;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'clickup_task_request_attachments'
      AND INDEX_NAME = 'clickup_task_request_attachments_request_idx'
  ) THEN
    ALTER TABLE clickup_task_request_attachments
      ADD INDEX clickup_task_request_attachments_request_idx (clickup_task_request_id, created_at);
  END IF;

  -- Replace legacy express-session table with current app session table.
  IF EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'sessions'
      AND COLUMN_NAME = 'session_id'
  ) THEN
    DROP TABLE sessions;
  END IF;

  -- User table columns required by the current auth and user-management flows.
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND COLUMN_NAME = 'avatar_url'
  ) THEN
    ALTER TABLE users ADD COLUMN avatar_url TEXT DEFAULT NULL AFTER email;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND COLUMN_NAME = 'status'
  ) THEN
    ALTER TABLE users
      ADD COLUMN status ENUM('pending_activation', 'active', 'inactive') NOT NULL DEFAULT 'active' AFTER role;
    UPDATE users SET status = IF(is_active = 1, 'active', 'inactive');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND COLUMN_NAME = 'page_access'
  ) THEN
    ALTER TABLE users ADD COLUMN page_access JSON DEFAULT NULL AFTER password_hash;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND COLUMN_NAME = 'google_subject'
  ) THEN
    ALTER TABLE users ADD COLUMN google_subject VARCHAR(255) DEFAULT NULL AFTER page_access;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND COLUMN_NAME = 'google_workspace_domain'
  ) THEN
    ALTER TABLE users ADD COLUMN google_workspace_domain VARCHAR(255) DEFAULT NULL AFTER google_subject;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND COLUMN_NAME = 'google_linked_at'
  ) THEN
    ALTER TABLE users ADD COLUMN google_linked_at DATETIME(3) DEFAULT NULL AFTER google_workspace_domain;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND COLUMN_NAME = 'invite_sent_at'
  ) THEN
    ALTER TABLE users ADD COLUMN invite_sent_at DATETIME(3) DEFAULT NULL AFTER google_linked_at;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND COLUMN_NAME = 'activated_at'
  ) THEN
    ALTER TABLE users ADD COLUMN activated_at DATETIME(3) DEFAULT NULL AFTER invite_sent_at;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND COLUMN_NAME = 'password_set_at'
  ) THEN
    ALTER TABLE users ADD COLUMN password_set_at DATETIME(3) DEFAULT NULL AFTER activated_at;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND COLUMN_NAME = 'last_login_at'
  ) THEN
    ALTER TABLE users ADD COLUMN last_login_at DATETIME(3) DEFAULT NULL AFTER password_set_at;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND COLUMN_NAME = 'updated_at'
  ) THEN
    ALTER TABLE users
      ADD COLUMN updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP AFTER created_at;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'users'
      AND INDEX_NAME = 'google_subject'
  ) THEN
    ALTER TABLE users ADD UNIQUE KEY google_subject (google_subject);
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'users'
      AND COLUMN_NAME = 'password_hash'
      AND IS_NULLABLE = 'NO'
  ) THEN
    ALTER TABLE users MODIFY COLUMN password_hash VARCHAR(255) DEFAULT NULL;
  END IF;

  -- PLUS update job table alignment. The table already exists in production
  -- with older column names, so CREATE TABLE IF NOT EXISTS is not enough.
  IF EXISTS (
    SELECT 1 FROM information_schema.TABLES
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'plus_update_jobs'
  ) THEN
    IF EXISTS (
      SELECT 1 FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'plus_update_jobs'
        AND COLUMN_NAME = 'template_key'
    ) AND NOT EXISTS (
      SELECT 1 FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'plus_update_jobs'
        AND COLUMN_NAME = 'upload_key'
    ) THEN
      ALTER TABLE plus_update_jobs CHANGE COLUMN template_key upload_key VARCHAR(512) DEFAULT NULL;
    END IF;

    IF EXISTS (
      SELECT 1 FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'plus_update_jobs'
        AND COLUMN_NAME = 'updated_rows'
    ) AND NOT EXISTS (
      SELECT 1 FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'plus_update_jobs'
        AND COLUMN_NAME = 'updated_count'
    ) THEN
      ALTER TABLE plus_update_jobs CHANGE COLUMN updated_rows updated_count INT NOT NULL DEFAULT 0;
    END IF;

    IF EXISTS (
      SELECT 1 FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'plus_update_jobs'
        AND COLUMN_NAME = 'skipped_rows'
    ) AND NOT EXISTS (
      SELECT 1 FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'plus_update_jobs'
        AND COLUMN_NAME = 'skipped_count'
    ) THEN
      ALTER TABLE plus_update_jobs CHANGE COLUMN skipped_rows skipped_count INT NOT NULL DEFAULT 0;
    END IF;

    IF EXISTS (
      SELECT 1 FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'plus_update_jobs'
        AND COLUMN_NAME = 'failed_rows'
    ) AND NOT EXISTS (
      SELECT 1 FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'plus_update_jobs'
        AND COLUMN_NAME = 'failed_count'
    ) THEN
      ALTER TABLE plus_update_jobs CHANGE COLUMN failed_rows failed_count INT NOT NULL DEFAULT 0;
    END IF;

    IF EXISTS (
      SELECT 1 FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'plus_update_jobs'
        AND COLUMN_NAME = 'partial_rows'
    ) THEN
      ALTER TABLE plus_update_jobs DROP COLUMN partial_rows;
    END IF;

    IF EXISTS (
      SELECT 1 FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'plus_update_jobs'
        AND COLUMN_NAME = 'current_fid'
    ) THEN
      ALTER TABLE plus_update_jobs DROP COLUMN current_fid;
    END IF;

    IF EXISTS (
      SELECT 1 FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'plus_update_jobs'
        AND COLUMN_NAME = 'preview_json'
    ) THEN
      ALTER TABLE plus_update_jobs DROP COLUMN preview_json;
    END IF;

    UPDATE plus_update_jobs
    SET status = 'running'
    WHERE status = 'uploaded';

    UPDATE plus_update_jobs
    SET started_at = COALESCE(started_at, created_at, CURRENT_TIMESTAMP(3))
    WHERE started_at IS NULL;

    ALTER TABLE plus_update_jobs
      MODIFY COLUMN status ENUM('running', 'completed', 'failed') NOT NULL DEFAULT 'running',
      MODIFY COLUMN started_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3);

    IF EXISTS (
      SELECT 1 FROM information_schema.STATISTICS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'plus_update_jobs'
        AND INDEX_NAME = 'plus_update_jobs_status_idx'
    ) THEN
      ALTER TABLE plus_update_jobs DROP INDEX plus_update_jobs_status_idx;
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM information_schema.STATISTICS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'plus_update_jobs'
        AND INDEX_NAME = 'plus_update_jobs_status_started_idx'
    ) THEN
      ALTER TABLE plus_update_jobs ADD INDEX plus_update_jobs_status_started_idx (status, started_at);
    END IF;
  END IF;
END$$

DELIMITER ;

CALL _prod_schema_alignment();
DROP PROCEDURE IF EXISTS _prod_schema_alignment;

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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS sessions (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT NOT NULL,
  token_hash CHAR(64) NOT NULL,
  remember BOOLEAN NOT NULL DEFAULT FALSE,
  expires_at DATETIME(3) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  last_seen_at DATETIME(3) DEFAULT NULL,
  CONSTRAINT fk_sessions_user_id
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  UNIQUE KEY uniq_session_token_hash (token_hash),
  INDEX sessions_user_idx (user_id, expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

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
  created_by_user_id BIGINT DEFAULT NULL,
  decision_by_user_id BIGINT DEFAULT NULL,
  decision_at DATETIME(3) DEFAULT NULL,
  decision_reason TEXT DEFAULT NULL,
  assigned_ms_user_id BIGINT DEFAULT NULL,
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
  lead_id BIGINT DEFAULT NULL,
  customer_name VARCHAR(255) NOT NULL,
  business_name VARCHAR(255) NOT NULL,
  business_type VARCHAR(255) NOT NULL,
  business_location VARCHAR(255) NOT NULL,
  meeting_location VARCHAR(255) DEFAULT NULL,
  appointment_type ENUM('Online', 'Physical') NOT NULL,
  scheduled_at DATETIME(3) NOT NULL,
  status ENUM('Pending', 'Completed', 'Canceled') NOT NULL DEFAULT 'Pending',
  created_by_user_id BIGINT DEFAULT NULL,
  completed_by_user_id BIGINT DEFAULT NULL,
  completed_at DATETIME(3) DEFAULT NULL,
  completion_note TEXT DEFAULT NULL,
  canceled_by_user_id BIGINT DEFAULT NULL,
  canceled_at DATETIME(3) DEFAULT NULL,
  cancel_reason TEXT DEFAULT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  INDEX sales_appointments_scheduled_idx (scheduled_at),
  INDEX sales_appointments_status_created_idx (status, created_at),
  INDEX sales_appointments_created_by_idx (created_by_user_id, created_at),
  INDEX sales_appointments_lead_idx (lead_id, created_at)
);

DROP PROCEDURE IF EXISTS _prod_schema_alignment_constraints;

DELIMITER $$

CREATE PROCEDURE _prod_schema_alignment_constraints()
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.TABLE_CONSTRAINTS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'ticket_history'
      AND CONSTRAINT_NAME = 'fk_ticket_history_ticket_id'
  ) THEN
    ALTER TABLE ticket_history
      ADD CONSTRAINT fk_ticket_history_ticket_id
        FOREIGN KEY (ticket_id) REFERENCES tickets(id) ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.TABLE_CONSTRAINTS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'csat_tokens'
      AND CONSTRAINT_NAME = 'fk_csat_tokens_ticket_id'
  ) THEN
    ALTER TABLE csat_tokens
      ADD CONSTRAINT fk_csat_tokens_ticket_id
        FOREIGN KEY (ticket_id) REFERENCES tickets(id) ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.TABLE_CONSTRAINTS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'csat_responses'
      AND CONSTRAINT_NAME = 'fk_csat_responses_ticket_id'
  ) THEN
    ALTER TABLE csat_responses
      ADD CONSTRAINT fk_csat_responses_ticket_id
        FOREIGN KEY (ticket_id) REFERENCES tickets(id) ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.TABLE_CONSTRAINTS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'clickup_task_request_attachments'
      AND CONSTRAINT_NAME = 'fk_clickup_task_request_attachments_clickup_task_request_id'
  ) THEN
    ALTER TABLE clickup_task_request_attachments
      ADD CONSTRAINT fk_clickup_task_request_attachments_clickup_task_request_id
        FOREIGN KEY (clickup_task_request_id) REFERENCES clickup_task_requests(id) ON DELETE CASCADE;
  END IF;
END$$

DELIMITER ;

CALL _prod_schema_alignment_constraints();
DROP PROCEDURE IF EXISTS _prod_schema_alignment_constraints;
