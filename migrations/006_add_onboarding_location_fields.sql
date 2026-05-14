ALTER TABLE onboarding_appointments
  ADD COLUMN location_name VARCHAR(255) DEFAULT NULL AFTER status,
  ADD COLUMN location_address VARCHAR(512) DEFAULT NULL AFTER location_name,
  ADD COLUMN google_place_id VARCHAR(255) DEFAULT NULL AFTER location_address,
  ADD COLUMN google_maps_uri VARCHAR(512) DEFAULT NULL AFTER google_place_id,
  ADD COLUMN location_lat DECIMAL(10, 7) DEFAULT NULL AFTER google_maps_uri,
  ADD COLUMN location_lng DECIMAL(10, 7) DEFAULT NULL AFTER location_lat,
  ADD INDEX onboarding_appointments_google_place_idx (google_place_id);
