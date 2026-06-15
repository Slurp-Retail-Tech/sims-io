ALTER TABLE onboarding_appointments
  MODIFY status ENUM('Pending', 'Approved', 'Completed', 'Canceled') NOT NULL DEFAULT 'Pending';

ALTER TABLE onboarding_appointments
  ADD COLUMN canceled_by_user_id BIGINT UNSIGNED DEFAULT NULL AFTER assigned_ms_user_id,
  ADD COLUMN canceled_at DATETIME(3) DEFAULT NULL AFTER canceled_by_user_id,
  ADD COLUMN cancel_reason TEXT DEFAULT NULL AFTER canceled_at;
