-- Schema snapshot (aligned with production support schema)

CREATE TABLE IF NOT EXISTS users (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(120) NOT NULL,
  email VARCHAR(255) NOT NULL UNIQUE,
  avatar_url TEXT DEFAULT NULL,
  department VARCHAR(80) NOT NULL,
  role VARCHAR(40) NOT NULL,
  status ENUM('pending_activation', 'active', 'inactive') NOT NULL DEFAULT 'pending_activation',
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  password_hash VARCHAR(255) DEFAULT NULL,
  page_access JSON DEFAULT NULL,
  google_subject VARCHAR(255) DEFAULT NULL UNIQUE,
  google_workspace_domain VARCHAR(255) DEFAULT NULL,
  google_linked_at DATETIME(3) DEFAULT NULL,
  invite_sent_at DATETIME(3) DEFAULT NULL,
  activated_at DATETIME(3) DEFAULT NULL,
  password_set_at DATETIME(3) DEFAULT NULL,
  last_login_at DATETIME(3) DEFAULT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS auth_tokens (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT UNSIGNED NOT NULL,
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

CREATE TABLE IF NOT EXISTS plus_update_jobs (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  status ENUM('running', 'completed', 'failed') NOT NULL DEFAULT 'running',
  requested_by VARCHAR(255) DEFAULT NULL,
  upload_key VARCHAR(512) DEFAULT NULL,
  total_rows INT NOT NULL DEFAULT 0,
  processed_rows INT NOT NULL DEFAULT 0,
  updated_count INT NOT NULL DEFAULT 0,
  skipped_count INT NOT NULL DEFAULT 0,
  failed_count INT NOT NULL DEFAULT 0,
  summary_json JSON DEFAULT NULL,
  error_message TEXT DEFAULT NULL,
  started_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  finished_at DATETIME(3) DEFAULT NULL,
  INDEX plus_update_jobs_status_started_idx (status, started_at)
);

-- Keep ticket categories as-is by request
CREATE TABLE IF NOT EXISTS ticket_categories (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(120) NOT NULL,
  parent_id BIGINT UNSIGNED DEFAULT NULL,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_ticket_categories_parent (parent_id)
);

CREATE TABLE IF NOT EXISTS support_requests (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  merchant_name VARCHAR(255) NOT NULL,
  outlet_name_resolved VARCHAR(255) NOT NULL,
  phone_number VARCHAR(32) NOT NULL,
  email VARCHAR(255) DEFAULT NULL,
  fid VARCHAR(4) NOT NULL,
  oid VARCHAR(2) NOT NULL,
  issue_type VARCHAR(255) NOT NULL,
  issue_subcategory1 VARCHAR(255) DEFAULT NULL,
  issue_subcategory2 VARCHAR(255) DEFAULT NULL,
  issue_description TEXT NOT NULL,
  ticket_description TEXT DEFAULT NULL,
  clickup_link VARCHAR(512) DEFAULT NULL,
  clickup_task_id VARCHAR(255) DEFAULT NULL,
  clickup_task_status VARCHAR(255) DEFAULT NULL,
  clickup_task_status_synced_at DATETIME(3) DEFAULT NULL,
  attachment_url VARCHAR(512) DEFAULT NULL,
  attachment_url_2 VARCHAR(512) DEFAULT NULL,
  attachment_url_3 VARCHAR(512) DEFAULT NULL,
  status ENUM('Open', 'In Progress', 'Pending Customer', 'Resolved') NOT NULL DEFAULT 'Open',
  closed_at DATETIME(3) DEFAULT NULL,
  updated_by VARCHAR(255) DEFAULT NULL,
  ms_pic_user_id BIGINT UNSIGNED DEFAULT NULL,
  hidden BOOLEAN NOT NULL DEFAULT FALSE,
  franchise_name_resolved VARCHAR(255) DEFAULT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  INDEX support_requests_status_created_idx (status, created_at)
);

CREATE TABLE IF NOT EXISTS support_request_history (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  request_id BIGINT UNSIGNED NOT NULL,
  field_name VARCHAR(255) NOT NULL,
  old_value TEXT DEFAULT NULL,
  new_value TEXT DEFAULT NULL,
  changed_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  changed_by VARCHAR(255) DEFAULT NULL,
  CONSTRAINT fk_support_request_history_request_id
    FOREIGN KEY (request_id) REFERENCES support_requests(id) ON DELETE CASCADE,
  INDEX support_request_history_request_idx (request_id, changed_at)
);

CREATE TABLE IF NOT EXISTS clickup_task_requests (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  ticket_id BIGINT UNSIGNED DEFAULT NULL,
  fid VARCHAR(4) DEFAULT NULL,
  oid VARCHAR(2) DEFAULT NULL,
  franchise_name VARCHAR(255) DEFAULT NULL,
  product VARCHAR(255) NOT NULL,
  department_request VARCHAR(255) NOT NULL,
  outlet_name_resolved VARCHAR(255) NOT NULL,
  ms_pic VARCHAR(255) NOT NULL,
  priority_level VARCHAR(255) NOT NULL,
  severity_level VARCHAR(255) NOT NULL,
  incident_title VARCHAR(255) NOT NULL,
  task_description TEXT NOT NULL,
  attachment_url VARCHAR(512) DEFAULT NULL,
  attachment_url_2 VARCHAR(512) DEFAULT NULL,
  attachment_url_3 VARCHAR(512) DEFAULT NULL,
  status ENUM('Pending Approval', 'Approved', 'Rejected') NOT NULL DEFAULT 'Pending Approval',
  created_by_user_id BIGINT UNSIGNED DEFAULT NULL,
  created_by_email VARCHAR(255) DEFAULT NULL,
  decision_reason TEXT DEFAULT NULL,
  decision_by_user_id BIGINT UNSIGNED DEFAULT NULL,
  decision_by_email VARCHAR(255) DEFAULT NULL,
  decision_at DATETIME(3) DEFAULT NULL,
  clickup_task_id VARCHAR(255) DEFAULT NULL,
  clickup_link VARCHAR(512) DEFAULT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  INDEX clickup_task_requests_status_created_idx (status, created_at),
  INDEX clickup_task_requests_created_by_idx (created_by_user_id, created_at),
  INDEX clickup_task_requests_ticket_idx (ticket_id)
);

CREATE TABLE IF NOT EXISTS clickup_task_request_attachments (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  request_id BIGINT UNSIGNED NOT NULL,
  storage_key VARCHAR(512) NOT NULL,
  original_name VARCHAR(255) DEFAULT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  CONSTRAINT fk_clickup_task_request_attachments_request_id
    FOREIGN KEY (request_id) REFERENCES clickup_task_requests(id) ON DELETE CASCADE,
  INDEX clickup_task_request_attachments_request_idx (request_id, created_at)
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

CREATE TABLE IF NOT EXISTS support_form_settings (
  id INT NOT NULL PRIMARY KEY,
  contact_phone VARCHAR(64) DEFAULT NULL,
  contact_email VARCHAR(255) DEFAULT NULL,
  issue_types JSON NOT NULL,
  category_config JSON NOT NULL,
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  updated_by VARCHAR(255) DEFAULT NULL
);

INSERT INTO support_form_settings (id, issue_types, category_config)
VALUES (
  1,
  JSON_ARRAY(
    'POS - Hardware',
    'POS - Software',
    'Payment Failure',
    'Settlement / Payout',
    'Menu Update',
    'Account & Billing',
    'Others'
  ),
  JSON_ARRAY()
)
ON DUPLICATE KEY UPDATE id = VALUES(id);

CREATE TABLE IF NOT EXISTS csat_tokens (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  request_id BIGINT UNSIGNED NOT NULL,
  token VARCHAR(255) NOT NULL UNIQUE,
  expires_at DATETIME(3) NOT NULL,
  used_at DATETIME(3) DEFAULT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  CONSTRAINT fk_csat_tokens_request_id
    FOREIGN KEY (request_id) REFERENCES support_requests(id) ON DELETE CASCADE,
  INDEX csat_tokens_request_idx (request_id)
);

CREATE TABLE IF NOT EXISTS csat_responses (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  request_id BIGINT UNSIGNED NOT NULL,
  token_id BIGINT UNSIGNED DEFAULT NULL,
  support_score VARCHAR(32) NOT NULL,
  support_reason TEXT DEFAULT NULL,
  product_score VARCHAR(32) NOT NULL,
  product_feedback TEXT DEFAULT NULL,
  submitted_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  CONSTRAINT fk_csat_responses_request_id
    FOREIGN KEY (request_id) REFERENCES support_requests(id) ON DELETE CASCADE,
  CONSTRAINT fk_csat_responses_token_id
    FOREIGN KEY (token_id) REFERENCES csat_tokens(id) ON DELETE SET NULL,
  UNIQUE KEY csat_responses_token_id_idx (token_id)
);

CREATE TABLE IF NOT EXISTS franchise_import_jobs (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  status ENUM('running', 'completed', 'failed') NOT NULL DEFAULT 'running',
  import_trigger ENUM('cron', 'manual') NOT NULL DEFAULT 'manual',
  requested_by VARCHAR(255) DEFAULT NULL,
  total_count INT DEFAULT NULL,
  processed_count INT NOT NULL DEFAULT 0,
  started_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  finished_at DATETIME(3) DEFAULT NULL,
  error_message TEXT DEFAULT NULL,
  INDEX franchise_import_jobs_status_idx (status, started_at)
);

CREATE TABLE IF NOT EXISTS franchise_cache (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  fid VARCHAR(32) DEFAULT NULL,
  franchise_name VARCHAR(255) DEFAULT NULL,
  franchise_json JSON DEFAULT NULL,
  outlets_json JSON NOT NULL,
  outlet_count INT NOT NULL DEFAULT 0,
  active_outlet_count INT NOT NULL DEFAULT 0,
  import_index INT NOT NULL,
  job_id BIGINT UNSIGNED DEFAULT NULL,
  is_active BOOLEAN NOT NULL DEFAULT FALSE,
  imported_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  CONSTRAINT fk_franchise_cache_job_id
    FOREIGN KEY (job_id) REFERENCES franchise_import_jobs(id) ON DELETE SET NULL,
  INDEX franchise_cache_active_idx (is_active, import_index),
  INDEX franchise_cache_fid_idx (fid)
);

CREATE TABLE IF NOT EXISTS leads (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  telephone VARCHAR(32) NOT NULL,
  email VARCHAR(255) NOT NULL,
  business_name VARCHAR(255) NOT NULL,
  business_type VARCHAR(255) NOT NULL,
  business_location VARCHAR(255) NOT NULL,
  source VARCHAR(255) DEFAULT NULL,
  referrer VARCHAR(1024) DEFAULT NULL,
  hubspot_contact_id VARCHAR(64) DEFAULT NULL,
  hubspot_sync_status ENUM('Pending', 'Success', 'Failed', 'Skipped') NOT NULL DEFAULT 'Pending',
  hubspot_sync_error TEXT DEFAULT NULL,
  hubspot_synced_at DATETIME(3) DEFAULT NULL,
  archived BOOLEAN NOT NULL DEFAULT FALSE,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  INDEX leads_created_idx (created_at),
  INDEX leads_email_idx (email)
);

CREATE TABLE IF NOT EXISTS lead_notification_settings (
  id INT NOT NULL PRIMARY KEY,
  is_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  sender_email VARCHAR(255) NOT NULL,
  recipients TEXT DEFAULT NULL,
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  updated_by VARCHAR(255) DEFAULT NULL
);

INSERT INTO lead_notification_settings (id, sender_email, recipients)
VALUES (1, 'marketing@leads.getslurp.com', 'marketing@getslurp.com')
ON DUPLICATE KEY UPDATE id = VALUES(id);

INSERT INTO users (name, email, department, role, status, is_active, password_hash)
VALUES (
  'Super Admin',
  'admin@getslurp.com',
  'Merchant Success',
  'Super Admin',
  'active',
  TRUE,
  'e910ed24ba65bf62f83ade706cd2d378:d7f8f1e86d39ac661c5bba0ef1c3337c685f556fe72ecdec912eb3ba799472dfe35dfa43586460bc60e9a0c4d0ed6401f0a5e05556b1c0f2d6b71f6b2e12d430'
)
ON DUPLICATE KEY UPDATE id = id;
