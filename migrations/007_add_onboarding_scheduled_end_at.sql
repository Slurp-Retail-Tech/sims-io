ALTER TABLE onboarding_appointments
  ADD COLUMN scheduled_end_at DATETIME(3) NULL AFTER scheduled_at;

UPDATE onboarding_appointments
SET scheduled_end_at = DATE_ADD(scheduled_at, INTERVAL 3 HOUR)
WHERE scheduled_end_at IS NULL;

ALTER TABLE onboarding_appointments
  MODIFY scheduled_end_at DATETIME(3) NOT NULL;
