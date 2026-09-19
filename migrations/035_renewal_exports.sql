-- 035: Bukku export batches.
--
-- One row per generated export file. Paid invoices carry bukku_export_id
-- (added in 032) pointing here, which is what lets the next export exclude
-- them by default and what flags an invoice voided after it was exported.
--
-- Forward-only, idempotent, no foreign keys.

CREATE TABLE IF NOT EXISTS renewal_bukku_exports (
  id                    BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  -- BKX-2026-08-001: year, month, running number within the month.
  reference             VARCHAR(32) NOT NULL,
  paid_from             DATE NOT NULL,
  paid_to               DATE NOT NULL,
  include_exported      TINYINT(1) NOT NULL DEFAULT 0,
  invoice_count         INT UNSIGNED NOT NULL DEFAULT 0,
  line_count            INT UNSIGNED NOT NULL DEFAULT 0,
  total_amount          DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  object_key            VARCHAR(512) DEFAULT NULL,
  generated_by_user_id  BIGINT DEFAULT NULL,
  created_at            DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  UNIQUE KEY renewal_bukku_exports_reference_uk (reference),
  INDEX renewal_bukku_exports_period_idx (paid_from, paid_to)
);
