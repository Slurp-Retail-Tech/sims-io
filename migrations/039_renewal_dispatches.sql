-- 039: one row per renewal message SIMS sends through Respond.io.
--
-- Reminders (first, second, final) go to the renewal PIC and every CC on each
-- channel they have enabled with a usable address; the receipt goes to the
-- same people on payment. Each (invoice, type, channel, recipient) is one row,
-- unique, so the nightly run can enqueue the same reminder twice without
-- sending it twice.
--
-- The row is written before the Respond.io call and updated after it, so a
-- crash mid-call leaves an auditable row rather than a silent gap (PRD 4.9).
--
-- `recipient_key` is `contact:{id}`. `address` is the identifier value the
-- message was sent to (an E.164 number or an email address), frozen at
-- enqueue so the record shows where a message went even if the contact is
-- later edited.
--
-- Payer documents stay on SMTP (see post-payment.ts) and are not recorded
-- here.
--
-- Forward-only and idempotent. No foreign keys, per the migrations convention.

CREATE TABLE IF NOT EXISTS renewal_dispatches (
  id                    BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  invoice_id            BIGINT UNSIGNED NOT NULL,
  dispatch_type         ENUM('reminder_first','reminder_second','reminder_final','receipt') NOT NULL,
  channel               ENUM('email','whatsapp') NOT NULL,
  recipient_key         VARCHAR(191) NOT NULL,
  contact_id            BIGINT UNSIGNED DEFAULT NULL,
  recipient_role        ENUM('pic','cc') NOT NULL,
  recipient_name        VARCHAR(255) DEFAULT NULL,
  address               VARCHAR(255) NOT NULL,

  status                ENUM('queued','sent','failed','suppressed','cancelled') NOT NULL DEFAULT 'queued',
  -- Why a row was suppressed or cancelled, or the last error on a failure.
  status_note           VARCHAR(500) DEFAULT NULL,
  attempts              INT UNSIGNED NOT NULL DEFAULT 0,
  next_attempt_at       DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  last_attempt_at       DATETIME(3) DEFAULT NULL,
  respondio_message_id  VARCHAR(64) DEFAULT NULL,
  sent_at               DATETIME(3) DEFAULT NULL,
  requested_by_user_id  BIGINT DEFAULT NULL,

  created_at            DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at            DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
                          ON UPDATE CURRENT_TIMESTAMP(3),

  UNIQUE KEY renewal_dispatches_once_uk (invoice_id, dispatch_type, channel, recipient_key),
  INDEX renewal_dispatches_due_idx (status, next_attempt_at),
  INDEX renewal_dispatches_invoice_idx (invoice_id, created_at)
);
