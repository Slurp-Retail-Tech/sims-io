-- 036: what happens after a payment is confirmed.
--
-- The callback (or the hourly Query sweep, or a staff member recording a bank
-- transfer) marks the proforma paid. Everything downstream of that is a
-- separate, retryable step recorded here, because the money is never in
-- question even when a later step fails:
--
--   1. extension   -- every outlet on the invoice moves from its previous
--                     expiry by the paid term, in one transaction
--   2. tax invoice -- INV- numbered, its own renewal_invoices row
--   3. documents   -- receipt and tax invoice PDFs
--   4. POS push    -- PATCH /api/outlet-valid-until/{fid}/{oid} per outlet
--   5. payer email -- the documents to whoever paid
--
-- outlet_subscription_extensions is one row per invoice line, unique on the
-- line, so a replayed job cannot extend an outlet twice. It also carries the
-- POS push state per outlet: a grouped invoice with one failed push shows
-- exactly which outlet the POS still disagrees on.
--
-- Forward-only, idempotent, no foreign keys (matching 027 onward). ALTERs are
-- guarded through information_schema so a re-run is a no-op.

CREATE TABLE IF NOT EXISTS outlet_subscription_extensions (
  id                    BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  outlet_subscription_id BIGINT UNSIGNED DEFAULT NULL,
  invoice_id            BIGINT UNSIGNED NOT NULL,
  invoice_item_id       BIGINT UNSIGNED NOT NULL,

  franchise_id          VARCHAR(120) NOT NULL,
  outlet_id             VARCHAR(120) NOT NULL,

  -- The date the outlet was renewing from and the date it was extended to.
  -- The new date is previous + term, never the payment date + term.
  previous_valid_until  DATETIME(3) DEFAULT NULL,
  new_valid_until       DATETIME(3) NOT NULL,
  term_months           INT NOT NULL,
  -- The line recorded one previous date at generation; the subscription may
  -- have moved since (a renewal outside SIMS). Stored when they differ.
  line_previous_valid_until DATETIME(3) DEFAULT NULL,

  applied_at            DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  pos_push_status       ENUM('pending','pushed','failed') NOT NULL DEFAULT 'pending',
  pos_push_attempts     INT UNSIGNED NOT NULL DEFAULT 0,
  pos_pushed_at         DATETIME(3) DEFAULT NULL,
  pos_push_last_error   VARCHAR(500) DEFAULT NULL,

  created_at            DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at            DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
                          ON UPDATE CURRENT_TIMESTAMP(3),

  -- One extension per invoice line. This, not a prior SELECT, is what makes
  -- the post-payment job safe to replay.
  UNIQUE KEY outlet_subscription_extensions_item_uk (invoice_item_id),
  INDEX outlet_subscription_extensions_invoice_idx (invoice_id),
  INDEX outlet_subscription_extensions_subscription_idx (outlet_subscription_id, applied_at),
  INDEX outlet_subscription_extensions_push_idx (pos_push_status, updated_at)
);

DROP PROCEDURE IF EXISTS _renewal_post_payment;

DELIMITER $$

CREATE PROCEDURE _renewal_post_payment()
BEGIN
  -- Which session the payment landed on, for the timeline and the receipt.
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'renewal_invoices'
      AND COLUMN_NAME = 'paid_session_id'
  ) THEN
    ALTER TABLE renewal_invoices
      ADD COLUMN paid_session_id BIGINT UNSIGNED DEFAULT NULL
        AFTER cap_transaction_number;
  END IF;

  -- For a payment recorded by staff: the bank reference and their note.
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'renewal_invoices'
      AND COLUMN_NAME = 'paid_reference'
  ) THEN
    ALTER TABLE renewal_invoices
      ADD COLUMN paid_reference VARCHAR(120) DEFAULT NULL
        AFTER paid_session_id;
  END IF;

  -- The payer-documents email is its own step with its own state, so a bad
  -- address never blocks the extension or the tax invoice.
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'renewal_invoices'
      AND COLUMN_NAME = 'payer_email_status'
  ) THEN
    ALTER TABLE renewal_invoices
      ADD COLUMN payer_email_status
        ENUM('not_applicable','pending','sent','failed')
        NOT NULL DEFAULT 'not_applicable'
        AFTER pos_push_status,
      ADD COLUMN payer_email_sent_at DATETIME(3) DEFAULT NULL
        AFTER payer_email_status,
      ADD COLUMN payer_email_error VARCHAR(500) DEFAULT NULL
        AFTER payer_email_sent_at;
  END IF;

  -- Two outcomes 034 did not anticipate: a second payment on an invoice
  -- already paid, and a refund reported by the gateway.
  IF EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'renewal_payment_callbacks'
      AND COLUMN_NAME = 'outcome'
      AND COLUMN_TYPE NOT LIKE '%overpayment%'
  ) THEN
    ALTER TABLE renewal_payment_callbacks
      MODIFY COLUMN outcome
        ENUM('accepted','duplicate','rejected_signature','unmatched',
             'amount_mismatch','ignored_status','error','overpayment','refunded')
        DEFAULT NULL;
  END IF;
END$$

DELIMITER ;

CALL _renewal_post_payment();
DROP PROCEDURE IF EXISTS _renewal_post_payment;
