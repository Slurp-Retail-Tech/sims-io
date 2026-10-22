-- 044: why an outlet did not renew.
--
-- A lapsed proforma marked its outlets non_renewed with a system-written
-- reason ("PI-… lapsed unpaid"), which says that it happened but not why.
-- Staff now pick the reason from a fixed list, so the Analytics page can say
-- how many merchants left for each one.
--
-- One row per outlet per renewal cycle: cycle_valid_until is the expiry the
-- outlet was due to renew from. The unique key lets a reason be corrected
-- rather than recorded twice, and a later cycle gets its own row. Hard
-- deletes are allowed: a reason recorded against the wrong outlet is removed,
-- and the invoice timeline keeps the trail where there was an invoice.
--
-- Forward-only and idempotent.

CREATE TABLE IF NOT EXISTS renewal_non_renewals (
  id                   BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  franchise_id         VARCHAR(120) NOT NULL,
  outlet_id            VARCHAR(120) NOT NULL,
  cycle_valid_until    DATE NOT NULL,
  invoice_id           BIGINT UNSIGNED DEFAULT NULL,
  reason               ENUM('change_of_ownership','closed_business','switched_system',
                            'freeze_account','temp_close','other') NOT NULL,
  note                 TEXT DEFAULT NULL,
  recorded_by_user_id  BIGINT DEFAULT NULL,
  recorded_at          DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at           DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
                         ON UPDATE CURRENT_TIMESTAMP(3),

  UNIQUE KEY renewal_non_renewals_cycle_uk (franchise_id, outlet_id, cycle_valid_until),
  INDEX renewal_non_renewals_reason_idx (reason, cycle_valid_until)
);
