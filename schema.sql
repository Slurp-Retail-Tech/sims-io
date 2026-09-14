-- Schema snapshot (aligned with production support schema)

CREATE TABLE IF NOT EXISTS users (
  id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
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

CREATE TABLE IF NOT EXISTS plus_update_jobs (
  id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
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

-- Contacts (migration 024). Declared before `tickets` because tickets.contact_id
-- references contacts(id).
--
-- `contact_outlets.outlet_id` NULL means "every outlet under this franchise".
-- `franchise_id` / `outlet_id` are VARCHAR business keys with no FK, matching how
-- merchant_outlets relates to merchants; merchant_outlets.external_id alone is not
-- unique, so it is not a valid FK target.
CREATE TABLE IF NOT EXISTS contacts (
  id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  email VARCHAR(255) NOT NULL,
  role VARCHAR(255) DEFAULT NULL,
  source ENUM('staff', 'respond_io') NOT NULL DEFAULT 'staff',
  respondio_contact_id VARCHAR(64) DEFAULT NULL,
  -- BIGINT UNSIGNED here to match this snapshot's users.id; migration 024 uses signed
  -- BIGINT to match the deployed users.id, which drifted to signed. See README.
  created_by_user_id BIGINT DEFAULT NULL,
  deleted_at DATETIME(3) DEFAULT NULL,
  deleted_by_user_id BIGINT DEFAULT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  CONSTRAINT fk_contacts_created_by
    FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT fk_contacts_deleted_by
    FOREIGN KEY (deleted_by_user_id) REFERENCES users(id) ON DELETE SET NULL,
  UNIQUE KEY contacts_respondio_contact_uk (respondio_contact_id),
  INDEX contacts_live_email_idx (deleted_at, email),
  INDEX contacts_live_name_idx (deleted_at, name)
);

CREATE TABLE IF NOT EXISTS contact_phone_numbers (
  id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  contact_id BIGINT NOT NULL,
  phone VARCHAR(32) NOT NULL,
  phone_normalized VARCHAR(32) NOT NULL,
  is_primary TINYINT(1) NOT NULL DEFAULT 0,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  CONSTRAINT fk_contact_phone_numbers_contact
    FOREIGN KEY (contact_id) REFERENCES contacts(id) ON DELETE CASCADE,
  UNIQUE KEY contact_phone_numbers_contact_phone_uk (contact_id, phone_normalized),
  INDEX contact_phone_numbers_normalized_idx (phone_normalized)
);

CREATE TABLE IF NOT EXISTS contact_outlets (
  id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  contact_id BIGINT NOT NULL,
  franchise_id VARCHAR(120) NOT NULL,
  outlet_id VARCHAR(120) DEFAULT NULL,
  created_by_user_id BIGINT DEFAULT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  CONSTRAINT fk_contact_outlets_contact
    FOREIGN KEY (contact_id) REFERENCES contacts(id) ON DELETE CASCADE,
  CONSTRAINT fk_contact_outlets_created_by
    FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE SET NULL,
  UNIQUE KEY contact_outlets_uk (contact_id, franchise_id, outlet_id),
  INDEX contact_outlets_scope_idx (franchise_id, outlet_id)
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

CREATE TABLE IF NOT EXISTS tickets (
  id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  merchant_name VARCHAR(255) NOT NULL,
  phone_number VARCHAR(32) NOT NULL,
  email VARCHAR(255) DEFAULT NULL,
  -- Nullable and VARCHAR(120) since migration 025: a Respond.io ticket may not
  -- resolve to an outlet, or may resolve only to a franchise (fid set, oid unset).
  fid VARCHAR(120) DEFAULT NULL,
  oid VARCHAR(120) DEFAULT NULL,
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
  source ENUM('support_form', 'manual', 'respond_io') NOT NULL DEFAULT 'support_form',
  respondio_contact_id VARCHAR(64) DEFAULT NULL,
  contact_id BIGINT DEFAULT NULL,
  needs_outlet_match TINYINT(1) NOT NULL DEFAULT 0,
  closed_at DATETIME(3) DEFAULT NULL,
  attended_at DATETIME(3) DEFAULT NULL,
  merchant_sentiment VARCHAR(50) DEFAULT NULL,
  updated_by VARCHAR(255) DEFAULT NULL,
  ms_pic_user_id BIGINT DEFAULT NULL,
  hidden TINYINT(1) NOT NULL DEFAULT 0,
  franchise_name_resolved VARCHAR(255) DEFAULT NULL,
  outlet_name_resolved VARCHAR(255) DEFAULT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  CONSTRAINT fk_tickets_contact
    FOREIGN KEY (contact_id) REFERENCES contacts(id) ON DELETE SET NULL,
  INDEX tickets_status_attended_idx (status, attended_at),
  INDEX tickets_respondio_contact_idx (respondio_contact_id, status),
  INDEX tickets_needs_outlet_idx (needs_outlet_match, status),
  INDEX tickets_attachment_url_idx (attachment_url(191)),
  INDEX tickets_attachment_url_2_idx (attachment_url_2(191)),
  INDEX tickets_attachment_url_3_idx (attachment_url_3(191))
);

CREATE TABLE IF NOT EXISTS ticket_history (
  id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  ticket_id BIGINT NOT NULL,
  field_name VARCHAR(255) NOT NULL,
  old_value TEXT DEFAULT NULL,
  new_value TEXT DEFAULT NULL,
  changed_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  changed_by VARCHAR(255) DEFAULT NULL,
  CONSTRAINT fk_ticket_history_ticket_id
    FOREIGN KEY (ticket_id) REFERENCES tickets(id) ON DELETE CASCADE,
  INDEX ticket_history_ticket_idx (ticket_id, changed_at)
);

CREATE TABLE IF NOT EXISTS clickup_task_requests (
  id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  ticket_id BIGINT DEFAULT NULL,
  -- Widened in migration 025 alongside tickets.fid / tickets.oid: these values are
  -- copied verbatim from a ticket, and the old VARCHAR(4)/VARCHAR(2) truncated
  -- real ids.
  fid VARCHAR(120) DEFAULT NULL,
  oid VARCHAR(120) DEFAULT NULL,
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
  created_by_user_id BIGINT DEFAULT NULL,
  created_by_email VARCHAR(255) DEFAULT NULL,
  decision_reason TEXT DEFAULT NULL,
  decision_by_user_id BIGINT DEFAULT NULL,
  decision_by_email VARCHAR(255) DEFAULT NULL,
  decision_at DATETIME(3) DEFAULT NULL,
  clickup_task_id VARCHAR(255) DEFAULT NULL,
  clickup_link VARCHAR(512) DEFAULT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  INDEX clickup_task_requests_status_created_idx (status, created_at),
  INDEX clickup_task_requests_created_by_idx (created_by_user_id, created_at),
  INDEX clickup_task_requests_ticket_idx (ticket_id),
  INDEX clickup_task_requests_attachment_url_idx (attachment_url(191)),
  INDEX clickup_task_requests_attachment_url_2_idx (attachment_url_2(191)),
  INDEX clickup_task_requests_attachment_url_3_idx (attachment_url_3(191))
);

CREATE TABLE IF NOT EXISTS clickup_task_request_attachments (
  id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  -- UNSIGNED to match clickup_task_requests.id above — MySQL requires FK
  -- column signedness to match exactly, and a fresh import fails otherwise.
  clickup_task_request_id BIGINT NOT NULL,
  storage_key VARCHAR(512) NOT NULL,
  original_name VARCHAR(255) DEFAULT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  CONSTRAINT fk_clickup_task_request_attachments_clickup_task_request_id
    FOREIGN KEY (clickup_task_request_id) REFERENCES clickup_task_requests(id) ON DELETE CASCADE,
  INDEX clickup_task_request_attachments_request_idx (clickup_task_request_id, created_at),
  INDEX clickup_task_request_attachments_storage_key_idx (storage_key(191))
);

CREATE TABLE IF NOT EXISTS onboarding_appointments (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  outlet_name VARCHAR(255) NOT NULL,
  installation_type ENUM('Online', 'On-site', 'Support') NOT NULL,
  scheduled_at DATETIME(3) NOT NULL,
  scheduled_end_at DATETIME(3) NOT NULL,
  payment_status ENUM('Pending', 'Paid', 'Unpaid') NOT NULL DEFAULT 'Pending',
  status ENUM('Pending', 'Approved', 'Completed', 'Canceled') NOT NULL DEFAULT 'Pending',
  location_name VARCHAR(255) DEFAULT NULL,
  location_address VARCHAR(512) DEFAULT NULL,
  google_place_id VARCHAR(255) DEFAULT NULL,
  google_maps_uri VARCHAR(512) DEFAULT NULL,
  location_lat DECIMAL(10, 7) DEFAULT NULL,
  location_lng DECIMAL(10, 7) DEFAULT NULL,
  created_by_user_id BIGINT NOT NULL,
  decision_by_user_id BIGINT DEFAULT NULL,
  decision_at DATETIME(3) DEFAULT NULL,
  decision_reason TEXT DEFAULT NULL,
  assigned_ms_user_id BIGINT DEFAULT NULL,
  canceled_by_user_id BIGINT UNSIGNED DEFAULT NULL,
  canceled_at DATETIME(3) DEFAULT NULL,
  cancel_reason TEXT DEFAULT NULL,
  google_calendar_id VARCHAR(255) DEFAULT NULL,
  google_event_id VARCHAR(255) DEFAULT NULL,
  google_event_etag VARCHAR(255) DEFAULT NULL,
  google_synced_at DATETIME(3) DEFAULT NULL,
  google_sync_status ENUM('pending', 'synced', 'failed') DEFAULT NULL,
  google_sync_error VARCHAR(500) DEFAULT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  INDEX onboarding_appointments_scheduled_idx (scheduled_at),
  INDEX onboarding_appointments_google_place_idx (google_place_id),
  INDEX onboarding_appointments_status_created_idx (status, created_at),
  INDEX onboarding_appointments_created_by_idx (created_by_user_id, created_at),
  INDEX onboarding_appointments_assigned_ms_idx (assigned_ms_user_id, scheduled_at),
  INDEX onboarding_appointments_google_event_idx (google_calendar_id, google_event_id)
);

CREATE TABLE IF NOT EXISTS onboarding_appointment_attachments (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  appointment_id BIGINT UNSIGNED NOT NULL,
  storage_key VARCHAR(512) NOT NULL,
  original_name VARCHAR(255) DEFAULT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  CONSTRAINT fk_onboarding_appointment_attachments_appointment_id
    FOREIGN KEY (appointment_id) REFERENCES onboarding_appointments(id) ON DELETE CASCADE,
  INDEX onboarding_appointment_attachments_request_idx (appointment_id, created_at),
  INDEX onboarding_appointment_attachments_storage_key_idx (storage_key(191))
);

CREATE TABLE IF NOT EXISTS sales_appointments (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  lead_id BIGINT DEFAULT NULL,
  customer_name VARCHAR(255) NOT NULL,
  business_name VARCHAR(255) NOT NULL,
  business_type VARCHAR(255) NOT NULL,
  business_location VARCHAR(255) NOT NULL,
  meeting_location VARCHAR(255) DEFAULT NULL,
  google_place_id VARCHAR(255) DEFAULT NULL,
  google_maps_uri VARCHAR(512) DEFAULT NULL,
  location_lat DECIMAL(10, 7) DEFAULT NULL,
  location_lng DECIMAL(10, 7) DEFAULT NULL,
  participant_emails VARCHAR(512) DEFAULT NULL,
  google_meet_link VARCHAR(512) DEFAULT NULL,
  appointment_type ENUM('Online', 'Physical') NOT NULL,
  scheduled_at DATETIME(3) NOT NULL,
  status ENUM('Pending', 'Completed', 'Canceled') NOT NULL DEFAULT 'Pending',
  created_by_user_id BIGINT NOT NULL,
  completed_by_user_id BIGINT DEFAULT NULL,
  completed_at DATETIME(3) DEFAULT NULL,
  completion_note TEXT DEFAULT NULL,
  canceled_by_user_id BIGINT DEFAULT NULL,
  canceled_at DATETIME(3) DEFAULT NULL,
  cancel_reason TEXT DEFAULT NULL,
  google_calendar_id VARCHAR(255) DEFAULT NULL,
  google_event_id VARCHAR(255) DEFAULT NULL,
  google_event_etag VARCHAR(255) DEFAULT NULL,
  google_synced_at DATETIME(3) DEFAULT NULL,
  google_sync_status ENUM('pending', 'synced', 'failed') DEFAULT NULL,
  google_sync_error VARCHAR(500) DEFAULT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  INDEX sales_appointments_scheduled_idx (scheduled_at),
  INDEX sales_appointments_status_created_idx (status, created_at),
  INDEX sales_appointments_created_by_idx (created_by_user_id, created_at),
  INDEX sales_appointments_lead_idx (lead_id, created_at),
  INDEX sales_appointments_google_event_idx (google_calendar_id, google_event_id)
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

-- token_hash: SHA-256 of the raw token sent in the CSAT survey URL
CREATE TABLE IF NOT EXISTS csat_tokens (
  id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  ticket_id BIGINT NOT NULL,
  token_hash CHAR(64) NOT NULL,
  expires_at DATETIME(3) NOT NULL,
  used_at DATETIME(3) DEFAULT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  CONSTRAINT fk_csat_tokens_ticket_id
    FOREIGN KEY (ticket_id) REFERENCES tickets(id) ON DELETE CASCADE,
  UNIQUE KEY uniq_csat_token_hash (token_hash),
  INDEX csat_tokens_ticket_idx (ticket_id)
);
-- NOTE: live DB still has column named request_id — run migration below to rename to ticket_id

CREATE TABLE IF NOT EXISTS csat_responses (
  id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  ticket_id BIGINT NOT NULL,
  token_id BIGINT DEFAULT NULL,
  support_score VARCHAR(32) NOT NULL,
  support_reason TEXT DEFAULT NULL,
  product_score VARCHAR(32) NOT NULL,
  product_feedback TEXT DEFAULT NULL,
  submitted_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  -- Google Review funnel: set when a qualifying (Satisfied/Very Satisfied support
  -- score) survey displayed the public review link, and when the link was clicked.
  google_review_shown_at DATETIME(3) DEFAULT NULL,
  google_review_clicked_at DATETIME(3) DEFAULT NULL,
  CONSTRAINT fk_csat_responses_ticket_id
    FOREIGN KEY (ticket_id) REFERENCES tickets(id) ON DELETE CASCADE,
  CONSTRAINT fk_csat_responses_token_id
    FOREIGN KEY (token_id) REFERENCES csat_tokens(id) ON DELETE SET NULL,
  UNIQUE KEY csat_responses_token_id_idx (token_id)
);
-- NOTE: live DB still has column named request_id — run migration below to rename to ticket_id

CREATE TABLE IF NOT EXISTS franchise_import_jobs (
  id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
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
  id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  fid VARCHAR(32) DEFAULT NULL,
  franchise_name VARCHAR(255) DEFAULT NULL,
  franchise_json JSON DEFAULT NULL,
  outlets_json JSON NOT NULL,
  outlet_count INT NOT NULL DEFAULT 0,
  active_outlet_count INT NOT NULL DEFAULT 0,
  import_index INT NOT NULL,
  job_id BIGINT DEFAULT NULL,
  is_active BOOLEAN NOT NULL DEFAULT FALSE,
  imported_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  CONSTRAINT fk_franchise_cache_job_id
    FOREIGN KEY (job_id) REFERENCES franchise_import_jobs(id) ON DELETE SET NULL,
  INDEX franchise_cache_active_idx (is_active, import_index),
  INDEX franchise_cache_fid_idx (fid)
);

CREATE TABLE IF NOT EXISTS leads (
  id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  telephone VARCHAR(32) NOT NULL,
  email VARCHAR(255) DEFAULT NULL,
  business_name VARCHAR(255) DEFAULT NULL,
  business_type VARCHAR(255) NOT NULL,
  business_location VARCHAR(255) NOT NULL,
  source VARCHAR(255) DEFAULT NULL,
  status ENUM('Unworked', 'Worked') NOT NULL DEFAULT 'Unworked',
  assigned_user_id BIGINT DEFAULT NULL,
  referrer VARCHAR(1024) DEFAULT NULL,
  origin VARCHAR(64) DEFAULT NULL,
  utm_source VARCHAR(255) DEFAULT NULL,
  utm_campaign VARCHAR(255) DEFAULT NULL,
  gclid VARCHAR(512) DEFAULT NULL,
  fbclid VARCHAR(512) DEFAULT NULL,
  hubspot_contact_id VARCHAR(64) DEFAULT NULL,
  hubspot_sync_status ENUM('Pending', 'Success', 'Failed', 'Skipped') NOT NULL DEFAULT 'Pending',
  hubspot_sync_error TEXT DEFAULT NULL,
  hubspot_synced_at DATETIME(3) DEFAULT NULL,
  archived BOOLEAN NOT NULL DEFAULT FALSE,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  CONSTRAINT fk_leads_assigned_user_id
    FOREIGN KEY (assigned_user_id) REFERENCES users(id) ON DELETE SET NULL,
  INDEX leads_created_idx (created_at),
  INDEX leads_email_idx (email),
  INDEX leads_status_idx (status),
  INDEX leads_assigned_user_idx (assigned_user_id, created_at)
);

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
  close_lost_remarks TEXT DEFAULT NULL,
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

-- Audit log of deal lifecycle events. Currently records deal creation and
-- every stage transition (from_stage -> to_stage). Append-only.
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

CREATE TABLE IF NOT EXISTS lead_activities (
  id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  lead_id BIGINT NOT NULL,
  deal_id BIGINT DEFAULT NULL,
  sales_appointment_id BIGINT UNSIGNED DEFAULT NULL,
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
  google_place_id VARCHAR(255) DEFAULT NULL,
  google_maps_uri VARCHAR(512) DEFAULT NULL,
  location_lat DECIMAL(10, 7) DEFAULT NULL,
  location_lng DECIMAL(10, 7) DEFAULT NULL,
  created_by_user_id BIGINT DEFAULT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) DEFAULT NULL,
  CONSTRAINT fk_lead_activities_lead_id
    FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE CASCADE,
  CONSTRAINT fk_lead_activities_deal_id
    FOREIGN KEY (deal_id) REFERENCES deals(id) ON DELETE SET NULL,
  CONSTRAINT fk_lead_activities_sales_appointment_id
    FOREIGN KEY (sales_appointment_id) REFERENCES sales_appointments(id) ON DELETE SET NULL,
  CONSTRAINT fk_lead_activities_created_by
    FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE SET NULL,
  INDEX lead_activities_lead_idx (lead_id, created_at),
  INDEX lead_activities_deal_idx (deal_id),
  INDEX lead_activities_sales_appointment_idx (sales_appointment_id),
  INDEX lead_activities_type_idx (lead_id, activity_type, created_at)
);

CREATE TABLE IF NOT EXISTS lead_notification_settings (
  id INT NOT NULL PRIMARY KEY,
  is_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  sender_email VARCHAR(255) NOT NULL,
  recipients TEXT DEFAULT NULL,
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  updated_by VARCHAR(255) DEFAULT NULL
);

-- Project Tracker: projects and per-project access control.
-- Phases/activities, dependencies and comments follow in the tables below.
CREATE TABLE IF NOT EXISTS projects (
  id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(160) NOT NULL,
  description TEXT DEFAULT NULL,
  start_date DATE NOT NULL,
  created_by_user_id BIGINT DEFAULT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  CONSTRAINT fk_projects_created_by
    FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE SET NULL,
  INDEX projects_created_at_idx (created_at)
);

CREATE TABLE IF NOT EXISTS project_members (
  id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  project_id BIGINT NOT NULL,
  user_id BIGINT NOT NULL,
  role ENUM('Owner', 'Editor', 'Viewer') NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  CONSTRAINT fk_project_members_project
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  CONSTRAINT fk_project_members_user
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  UNIQUE KEY project_members_project_user_uk (project_id, user_id),
  INDEX project_members_user_idx (user_id, project_id)
);

-- Phases and activities share one table: a Phase has no parent, an Activity must
-- have one (enforced by chk_project_items_shape). Dependencies and comments must
-- be able to target either kind, so a single table lets them carry one real FK per
-- reference instead of pairs of nullable ones.
--
-- Soft delete is never cascaded to children: an item is effectively deleted when
-- its own or its parent's deleted_at is set, so restoring a phase restores exactly
-- the children that were not deleted individually.
CREATE TABLE IF NOT EXISTS project_items (
  id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  project_id BIGINT NOT NULL,
  parent_item_id BIGINT DEFAULT NULL,
  item_type ENUM('Phase', 'Activity') NOT NULL,
  name VARCHAR(200) NOT NULL,
  description TEXT DEFAULT NULL,
  status ENUM('Not Started', 'In Progress', 'Blocked', 'Completed')
    NOT NULL DEFAULT 'Not Started',
  assigned_user_id BIGINT DEFAULT NULL,
  start_date DATE DEFAULT NULL,
  due_date DATE DEFAULT NULL,
  sort_order INT NOT NULL DEFAULT 0,
  completed_at DATETIME(3) DEFAULT NULL,
  deleted_at DATETIME(3) DEFAULT NULL,
  deleted_by_user_id BIGINT DEFAULT NULL,
  created_by_user_id BIGINT DEFAULT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  CONSTRAINT fk_project_items_project
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  CONSTRAINT fk_project_items_parent
    FOREIGN KEY (parent_item_id) REFERENCES project_items(id),
  CONSTRAINT fk_project_items_assigned_user
    FOREIGN KEY (assigned_user_id) REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT fk_project_items_deleted_by
    FOREIGN KEY (deleted_by_user_id) REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT fk_project_items_created_by
    FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT chk_project_items_shape CHECK (
    (item_type = 'Phase' AND parent_item_id IS NULL)
    OR (item_type = 'Activity' AND parent_item_id IS NOT NULL)
  ),
  UNIQUE KEY project_items_id_project_uk (id, project_id),
  INDEX project_items_tree_idx (project_id, parent_item_id, sort_order),
  INDEX project_items_assigned_idx (assigned_user_id),
  INDEX project_items_status_idx (project_id, status),
  INDEX project_items_live_idx (project_id, deleted_at)
);

-- Finish-to-start dependencies: `item_id` is unblocked once `depends_on_item_id`
-- reaches status 'Completed'. The composite FKs onto (id, project_id) make
-- "same project only" a database guarantee; cycles are rejected in application
-- code (src/lib/project-dependencies.ts) under a project row lock.
CREATE TABLE IF NOT EXISTS project_item_dependencies (
  id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  project_id BIGINT NOT NULL,
  item_id BIGINT NOT NULL,
  depends_on_item_id BIGINT NOT NULL,
  created_by_user_id BIGINT DEFAULT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  CONSTRAINT fk_project_item_deps_item
    FOREIGN KEY (item_id, project_id)
    REFERENCES project_items(id, project_id) ON DELETE CASCADE,
  CONSTRAINT fk_project_item_deps_predecessor
    FOREIGN KEY (depends_on_item_id, project_id)
    REFERENCES project_items(id, project_id) ON DELETE CASCADE,
  CONSTRAINT fk_project_item_deps_created_by
    FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT chk_project_item_deps_no_self CHECK (item_id <> depends_on_item_id),
  UNIQUE KEY project_item_deps_uk (item_id, depends_on_item_id),
  INDEX project_item_deps_reverse_idx (depends_on_item_id),
  INDEX project_item_deps_project_idx (project_id)
);

-- Comments on phases and activities. Mentions live inline in `body` as canonical
-- `@[Display Name](userId)` markers, resolved by a pure parser
-- (src/lib/project-comments.ts) that validates project access at write time —
-- there is deliberately no mentions join table.
--
-- Comments survive soft delete of their item: soft delete only sets
-- project_items.deleted_at, so these rows stay retrievable for audit.
CREATE TABLE IF NOT EXISTS project_item_comments (
  id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  project_id BIGINT NOT NULL,
  item_id BIGINT NOT NULL,
  body TEXT NOT NULL,
  created_by_user_id BIGINT DEFAULT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  CONSTRAINT fk_project_item_comments_item
    FOREIGN KEY (item_id, project_id)
    REFERENCES project_items(id, project_id) ON DELETE CASCADE,
  CONSTRAINT fk_project_item_comments_created_by
    FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE SET NULL,
  INDEX project_item_comments_item_idx (item_id, created_at),
  INDEX project_item_comments_project_idx (project_id, created_at)
);

-- Respond.io -> SIMS ticket automation (migration 025).
--
-- `respondio_webhook_events` doubles as the idempotency ledger: n8n retries on
-- failure and may redeliver the same event, so `idempotency_key` is UNIQUE and the
-- endpoint inserts first. A duplicate insert fails on ER_DUP_ENTRY and the call
-- returns with zero side effects.
--
-- Secrets are a separate multi-row table so rotation has a grace window (a new key
-- can be issued while the previous one still verifies). Only the sha256 of the
-- secret is stored; the raw value is shown once, at creation.
CREATE TABLE IF NOT EXISTS respondio_settings (
  id INT NOT NULL PRIMARY KEY,
  routing_tag VARCHAR(120) NOT NULL,
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  updated_by VARCHAR(255) DEFAULT NULL
);

CREATE TABLE IF NOT EXISTS respondio_webhook_events (
  id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  event_type VARCHAR(64) NOT NULL,
  respondio_contact_id VARCHAR(64) DEFAULT NULL,
  idempotency_key CHAR(64) NOT NULL,
  payload_raw JSON NOT NULL,
  secret_valid TINYINT(1) NOT NULL DEFAULT 0,
  processing_status ENUM(
    'processing', 'processed', 'ignored', 'rejected', 'noop', 'failed'
  ) NOT NULL DEFAULT 'processing',
  error_message TEXT DEFAULT NULL,
  result_summary VARCHAR(255) DEFAULT NULL,
  ticket_id BIGINT DEFAULT NULL,
  received_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  processed_at DATETIME(3) DEFAULT NULL,
  UNIQUE KEY respondio_webhook_events_idem_uk (idempotency_key),
  INDEX respondio_webhook_events_received_idx (received_at),
  INDEX respondio_webhook_events_contact_idx (respondio_contact_id)
);

CREATE TABLE IF NOT EXISTS respondio_integration_secrets (
  id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  key_id CHAR(12) NOT NULL,
  secret_hash CHAR(64) NOT NULL,
  secret_prefix VARCHAR(16) NOT NULL,
  secret_last4 CHAR(4) NOT NULL,
  created_by_user_id BIGINT DEFAULT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  revoked_at DATETIME(3) DEFAULT NULL,
  revoked_by_user_id BIGINT DEFAULT NULL,
  last_used_at DATETIME(3) DEFAULT NULL,
  CONSTRAINT fk_respondio_secrets_created_by
    FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT fk_respondio_secrets_revoked_by
    FOREIGN KEY (revoked_by_user_id) REFERENCES users(id) ON DELETE SET NULL,
  UNIQUE KEY respondio_integration_secrets_key_id_uk (key_id),
  INDEX respondio_integration_secrets_hash_idx (secret_hash),
  INDEX respondio_integration_secrets_active_idx (revoked_at, created_at)
);

INSERT INTO respondio_settings (id, routing_tag)
VALUES (1, 'team:merchant_success')
ON DUPLICATE KEY UPDATE id = VALUES(id);

-- Tickets auto-created from Respond.io have no triage yet, but tickets.issue_type
-- is NOT NULL. This gives the placeholder a matching option in the ticket-edit
-- category dropdown instead of rendering blank.
INSERT INTO ticket_categories (name, parent_id, sort_order)
SELECT 'Unclassified', NULL, 999 FROM DUAL
WHERE NOT EXISTS (
  SELECT 1 FROM ticket_categories AS tc
  WHERE tc.name = 'Unclassified' AND tc.parent_id IS NULL
);

INSERT INTO lead_notification_settings (id, sender_email, recipients)
VALUES (1, 'marketing@leads.getslurp.com', 'marketing@getslurp.com')
ON DUPLICATE KEY UPDATE id = VALUES(id);

INSERT INTO users (name, email, department, role, status, is_active)
VALUES (
  'Super Admin',
  'admin@getslurp.com',
  'Merchant Success',
  'Super Admin',
  'pending_activation',
  TRUE
)
ON DUPLICATE KEY UPDATE id = id;
