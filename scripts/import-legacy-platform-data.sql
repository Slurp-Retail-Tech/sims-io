-- Import data from a legacy `sims-platform` dump staged in the
-- `legacy_sims_platform` schema into the current schema from `schema.sql`.
--
-- Expected workflow:
-- 1. Create a staging schema and load the dump:
--      CREATE DATABASE legacy_sims_platform;
--      USE legacy_sims_platform;
--      SOURCE /Users/hafiz/Downloads/sims-platform.sql;
-- 2. Connect to the target schema that already has `schema.sql` applied.
-- 3. Run:
--      SOURCE /Users/hafiz/sims-io/scripts/import-legacy-platform-data.sql;
--
-- This script assumes the target tables are empty.

START TRANSACTION;
SET FOREIGN_KEY_CHECKS = 0;

INSERT INTO users (
  id,
  name,
  email,
  department,
  role,
  status,
  is_active,
  password_hash,
  created_at,
  updated_at
)
SELECT
  legacy.id,
  COALESCE(NULLIF(legacy.name, ""), SUBSTRING_INDEX(legacy.email, "@", 1)),
  legacy.email,
  COALESCE(NULLIF(legacy.department, ""), "Merchant Success"),
  COALESCE(NULLIF(legacy.role, ""), "User"),
  CASE
    WHEN legacy.is_active = 1 THEN "active"
    ELSE "inactive"
  END,
  legacy.is_active,
  NULLIF(legacy.password_hash, ""),
  legacy.created_at,
  legacy.created_at
FROM legacy_sims_platform.users AS legacy;

INSERT INTO support_requests (
  id,
  merchant_name,
  outlet_name_resolved,
  phone_number,
  email,
  fid,
  oid,
  issue_type,
  issue_subcategory1,
  issue_subcategory2,
  issue_description,
  ticket_description,
  clickup_link,
  clickup_task_id,
  clickup_task_status,
  clickup_task_status_synced_at,
  attachment_url,
  attachment_url_2,
  attachment_url_3,
  status,
  closed_at,
  updated_by,
  ms_pic_user_id,
  hidden,
  franchise_name_resolved,
  created_at,
  updated_at
)
SELECT
  legacy.id,
  legacy.merchant_name,
  legacy.outlet_name_resolved,
  legacy.phone_number,
  legacy.email,
  legacy.fid,
  legacy.oid,
  legacy.issue_type,
  legacy.issue_subcategory1,
  legacy.issue_subcategory2,
  legacy.issue_description,
  legacy.ticket_description,
  legacy.clickup_link,
  legacy.clickup_task_id,
  legacy.clickup_task_status,
  legacy.clickup_task_status_synced_at,
  legacy.attachment_url,
  legacy.attachment_url_2,
  legacy.attachment_url_3,
  legacy.status,
  legacy.closed_at,
  legacy.updated_by,
  legacy.ms_pic_user_id,
  legacy.hidden,
  legacy.franchise_name_resolved,
  legacy.created_at,
  legacy.updated_at
FROM legacy_sims_platform.support_requests AS legacy;

INSERT INTO support_request_history (
  id,
  request_id,
  field_name,
  old_value,
  new_value,
  changed_at,
  changed_by
)
SELECT
  legacy.id,
  legacy.request_id,
  legacy.field_name,
  legacy.old_value,
  legacy.new_value,
  legacy.changed_at,
  legacy.changed_by
FROM legacy_sims_platform.support_request_history AS legacy;

INSERT INTO clickup_task_requests (
  id,
  ticket_id,
  fid,
  oid,
  franchise_name,
  product,
  department_request,
  outlet_name_resolved,
  ms_pic,
  priority_level,
  severity_level,
  incident_title,
  task_description,
  attachment_url,
  attachment_url_2,
  attachment_url_3,
  status,
  created_by_user_id,
  created_by_email,
  decision_reason,
  decision_by_user_id,
  decision_by_email,
  decision_at,
  clickup_task_id,
  clickup_link,
  created_at,
  updated_at
)
SELECT
  legacy.id,
  legacy.ticket_id,
  legacy.fid,
  legacy.oid,
  legacy.franchise_name,
  legacy.product,
  legacy.department_request,
  legacy.outlet_name_resolved,
  legacy.ms_pic,
  legacy.priority_level,
  legacy.severity_level,
  legacy.incident_title,
  legacy.task_description,
  legacy.attachment_url,
  legacy.attachment_url_2,
  legacy.attachment_url_3,
  legacy.status,
  legacy.created_by_user_id,
  legacy.created_by_email,
  legacy.decision_reason,
  legacy.decision_by_user_id,
  legacy.decision_by_email,
  legacy.decision_at,
  legacy.clickup_task_id,
  legacy.clickup_link,
  legacy.created_at,
  legacy.updated_at
FROM legacy_sims_platform.clickup_task_requests AS legacy;

INSERT INTO clickup_task_request_attachments (
  id,
  request_id,
  storage_key,
  original_name,
  created_at
)
SELECT
  legacy.id,
  legacy.request_id,
  legacy.storage_key,
  legacy.original_name,
  legacy.created_at
FROM legacy_sims_platform.clickup_task_request_attachments AS legacy;

INSERT INTO csat_tokens (
  id,
  request_id,
  token,
  expires_at,
  used_at,
  created_at
)
SELECT
  legacy.id,
  legacy.request_id,
  legacy.token,
  legacy.expires_at,
  legacy.used_at,
  legacy.created_at
FROM legacy_sims_platform.csat_tokens AS legacy;

INSERT INTO csat_responses (
  id,
  request_id,
  token_id,
  support_score,
  support_reason,
  product_score,
  product_feedback,
  submitted_at
)
SELECT
  legacy.id,
  legacy.request_id,
  legacy.token_id,
  legacy.support_score,
  legacy.support_reason,
  legacy.product_score,
  legacy.product_feedback,
  legacy.submitted_at
FROM legacy_sims_platform.csat_responses AS legacy;

INSERT INTO franchise_import_jobs (
  id,
  status,
  import_trigger,
  requested_by,
  total_count,
  processed_count,
  started_at,
  finished_at,
  error_message
)
SELECT
  legacy.id,
  legacy.status,
  legacy.import_trigger,
  legacy.requested_by,
  legacy.total_count,
  legacy.processed_count,
  legacy.started_at,
  legacy.finished_at,
  legacy.error_message
FROM legacy_sims_platform.franchise_import_jobs AS legacy;

INSERT INTO franchise_cache (
  id,
  fid,
  franchise_name,
  franchise_json,
  outlets_json,
  outlet_count,
  active_outlet_count,
  import_index,
  job_id,
  is_active,
  imported_at
)
SELECT
  legacy.id,
  legacy.fid,
  legacy.franchise_name,
  legacy.franchise_json,
  legacy.outlets_json,
  legacy.outlet_count,
  legacy.active_outlet_count,
  legacy.import_index,
  legacy.job_id,
  legacy.is_active,
  legacy.imported_at
FROM legacy_sims_platform.franchise_cache AS legacy;

INSERT INTO leads (
  id,
  name,
  telephone,
  email,
  business_name,
  business_type,
  business_location,
  source,
  referrer,
  hubspot_contact_id,
  hubspot_sync_status,
  hubspot_sync_error,
  hubspot_synced_at,
  archived,
  created_at,
  updated_at
)
SELECT
  legacy.id,
  legacy.name,
  legacy.telephone,
  legacy.email,
  legacy.business_name,
  legacy.business_type,
  legacy.business_location,
  legacy.source,
  legacy.referrer,
  legacy.hubspot_contact_id,
  legacy.hubspot_sync_status,
  legacy.hubspot_sync_error,
  legacy.hubspot_synced_at,
  legacy.archived,
  legacy.created_at,
  legacy.updated_at
FROM legacy_sims_platform.leads AS legacy;

INSERT INTO lead_notification_settings (
  id,
  is_enabled,
  sender_email,
  recipients,
  updated_at,
  updated_by
)
SELECT
  legacy.id,
  legacy.is_enabled,
  legacy.sender_email,
  legacy.recipients,
  legacy.updated_at,
  legacy.updated_by
FROM legacy_sims_platform.lead_notification_settings AS legacy;

INSERT INTO support_form_settings (
  id,
  contact_phone,
  contact_email,
  issue_types,
  category_config,
  updated_at,
  updated_by
)
SELECT
  legacy.id,
  legacy.contact_phone,
  legacy.contact_email,
  legacy.issue_types,
  legacy.category_config,
  legacy.updated_at,
  legacy.updated_by
FROM legacy_sims_platform.support_form_settings AS legacy;

INSERT INTO plus_update_jobs (
  id,
  status,
  requested_by,
  upload_key,
  total_rows,
  processed_rows,
  updated_count,
  skipped_count,
  failed_count,
  summary_json,
  error_message,
  started_at,
  finished_at
)
SELECT
  legacy.id,
  CASE legacy.status
    WHEN "completed" THEN "completed"
    WHEN "failed" THEN "failed"
    ELSE "running"
  END,
  legacy.requested_by,
  legacy.template_key,
  legacy.total_rows,
  legacy.processed_rows,
  legacy.updated_rows,
  legacy.skipped_rows + legacy.partial_rows,
  legacy.failed_rows,
  CASE
    WHEN legacy.summary_json IS NOT NULL AND legacy.preview_json IS NOT NULL THEN
      JSON_MERGE_PATCH(
        JSON_OBJECT("preview", legacy.preview_json),
        legacy.summary_json
      )
    WHEN legacy.summary_json IS NOT NULL THEN legacy.summary_json
    WHEN legacy.preview_json IS NOT NULL THEN JSON_OBJECT("preview", legacy.preview_json)
    ELSE NULL
  END,
  legacy.error_message,
  COALESCE(legacy.started_at, legacy.created_at),
  legacy.finished_at
FROM legacy_sims_platform.plus_update_jobs AS legacy;

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
    WHEN "completed" THEN "success"
    WHEN "failed" THEN "failed"
    ELSE "running"
  END,
  legacy.started_at,
  legacy.finished_at,
  COALESCE(legacy.processed_count, 0),
  legacy.error_message
FROM legacy_sims_platform.franchise_import_jobs AS legacy;

WITH ranked_franchises AS (
  SELECT
    legacy.*,
    COALESCE(
      NULLIF(JSON_UNQUOTE(JSON_EXTRACT(legacy.franchise_json, "$.id")), "null"),
      legacy.fid,
      CAST(legacy.id AS CHAR)
    ) AS merchant_external_id,
    COALESCE(
      NULLIF(JSON_UNQUOTE(JSON_EXTRACT(legacy.franchise_json, "$.name")), "null"),
      NULLIF(legacy.franchise_name, ""),
      CONCAT("Merchant ", legacy.fid)
    ) AS merchant_name,
    ROW_NUMBER() OVER (
      PARTITION BY legacy.fid
      ORDER BY legacy.is_active DESC, legacy.imported_at DESC, legacy.id DESC
    ) AS row_num
  FROM legacy_sims_platform.franchise_cache AS legacy
  WHERE legacy.fid IS NOT NULL
),
latest_franchises AS (
  SELECT *
  FROM ranked_franchises
  WHERE row_num = 1
)
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
    WHEN LOWER(COALESCE(JSON_UNQUOTE(JSON_EXTRACT(legacy.franchise_json, "$.closed_account")), "false")) = "true" THEN "Closed"
    WHEN LOWER(COALESCE(JSON_UNQUOTE(JSON_EXTRACT(legacy.franchise_json, "$.test_account")), "false")) = "true" THEN "Test"
    WHEN legacy.is_active = 1 THEN "Active"
    ELSE "Inactive"
  END,
  COALESCE(
    legacy.franchise_json,
    JSON_OBJECT(
      "id", legacy.fid,
      "name", legacy.franchise_name,
      "outlets", JSON_ARRAY()
    )
  ),
  legacy.imported_at,
  legacy.imported_at
FROM latest_franchises AS legacy;

WITH ranked_franchises AS (
  SELECT
    legacy.*,
    COALESCE(
      NULLIF(JSON_UNQUOTE(JSON_EXTRACT(legacy.franchise_json, "$.id")), "null"),
      legacy.fid,
      CAST(legacy.id AS CHAR)
    ) AS merchant_external_id,
    ROW_NUMBER() OVER (
      PARTITION BY legacy.fid
      ORDER BY legacy.is_active DESC, legacy.imported_at DESC, legacy.id DESC
    ) AS row_num
  FROM legacy_sims_platform.franchise_cache AS legacy
  WHERE legacy.fid IS NOT NULL
),
latest_franchises AS (
  SELECT *
  FROM ranked_franchises
  WHERE row_num = 1
)
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
    NULLIF(outlet.outlet_id, ""),
    NULLIF(outlet.oid, ""),
    CONCAT(legacy.fid, "-", outlet.row_num)
  ) AS external_id,
  legacy.merchant_external_id,
  COALESCE(
    NULLIF(outlet.outlet_name, ""),
    NULLIF(outlet.outlet_name_alt, ""),
    CONCAT("Outlet ", COALESCE(outlet.outlet_id, outlet.oid, outlet.row_num))
  ) AS name,
  CASE
    WHEN LOWER(COALESCE(outlet.closed_account, "false")) = "true" THEN "Closed"
    WHEN LOWER(COALESCE(outlet.test_account, "false")) = "true" THEN "Test"
    WHEN legacy.is_active = 1 THEN "Active"
    ELSE "Inactive"
  END,
  outlet.raw_payload,
  legacy.imported_at,
  legacy.imported_at
FROM latest_franchises AS legacy
JOIN JSON_TABLE(
  legacy.outlets_json,
  "$[*]" COLUMNS (
    row_num FOR ORDINALITY,
    outlet_id VARCHAR(120) PATH "$.id" DEFAULT NULL ON EMPTY,
    oid VARCHAR(120) PATH "$.oid" DEFAULT NULL ON EMPTY,
    outlet_name VARCHAR(255) PATH "$.name" DEFAULT NULL ON EMPTY,
    outlet_name_alt VARCHAR(255) PATH "$.outlet_name" DEFAULT NULL ON EMPTY,
    closed_account VARCHAR(10) PATH "$.closed_account" DEFAULT NULL ON EMPTY,
    test_account VARCHAR(10) PATH "$.test_account" DEFAULT NULL ON EMPTY,
    raw_payload JSON PATH "$"
  )
) AS outlet
WHERE JSON_VALID(legacy.outlets_json)
  AND JSON_LENGTH(legacy.outlets_json) > 0;

SET FOREIGN_KEY_CHECKS = 1;
COMMIT;
