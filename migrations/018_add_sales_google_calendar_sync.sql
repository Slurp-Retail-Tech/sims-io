-- Add Google Calendar sync columns to sales_appointments (mirrors onboarding_appointments)
ALTER TABLE sales_appointments
  ADD COLUMN google_calendar_id VARCHAR(255) DEFAULT NULL AFTER cancel_reason,
  ADD COLUMN google_event_id VARCHAR(255) DEFAULT NULL AFTER google_calendar_id,
  ADD COLUMN google_event_etag VARCHAR(255) DEFAULT NULL AFTER google_event_id,
  ADD COLUMN google_synced_at DATETIME(3) DEFAULT NULL AFTER google_event_etag,
  ADD COLUMN google_sync_status ENUM('pending', 'synced', 'failed') DEFAULT NULL AFTER google_synced_at,
  ADD COLUMN google_sync_error VARCHAR(500) DEFAULT NULL AFTER google_sync_status,
  ADD INDEX sales_appointments_google_event_idx (google_calendar_id, google_event_id);
