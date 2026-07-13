-- Two-way link: lead Meeting activities remember the sales appointment they created,
-- plus structured Google Places fields on both tables (mirrors onboarding_appointments,
-- migration 006) and participant/Meet fields for sales calendar invites.
ALTER TABLE lead_activities
  ADD COLUMN sales_appointment_id BIGINT UNSIGNED DEFAULT NULL AFTER deal_id,
  ADD COLUMN google_place_id VARCHAR(255) DEFAULT NULL AFTER location,
  ADD COLUMN google_maps_uri VARCHAR(512) DEFAULT NULL AFTER google_place_id,
  ADD COLUMN location_lat DECIMAL(10, 7) DEFAULT NULL AFTER google_maps_uri,
  ADD COLUMN location_lng DECIMAL(10, 7) DEFAULT NULL AFTER location_lat,
  ADD CONSTRAINT fk_lead_activities_sales_appointment_id
    FOREIGN KEY (sales_appointment_id) REFERENCES sales_appointments(id) ON DELETE SET NULL,
  ADD INDEX lead_activities_sales_appointment_idx (sales_appointment_id);

ALTER TABLE sales_appointments
  ADD COLUMN google_place_id VARCHAR(255) DEFAULT NULL AFTER meeting_location,
  ADD COLUMN google_maps_uri VARCHAR(512) DEFAULT NULL AFTER google_place_id,
  ADD COLUMN location_lat DECIMAL(10, 7) DEFAULT NULL AFTER google_maps_uri,
  ADD COLUMN location_lng DECIMAL(10, 7) DEFAULT NULL AFTER location_lat,
  ADD COLUMN participant_emails VARCHAR(512) DEFAULT NULL AFTER location_lng,
  ADD COLUMN google_meet_link VARCHAR(512) DEFAULT NULL AFTER participant_emails;
