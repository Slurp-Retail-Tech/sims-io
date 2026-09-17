-- 034: payment sessions, link engagement, and the callback ledger.
--
-- A payment session is one attempt to collect one invoice through
-- CommercePay's hosted session checkout. An invoice may have several: a term
-- change supersedes the open session (the amount changed), an expired session
-- is replaced on the next attempt. The reference code sent to the gateway is
-- `{invoice number}-{sequence}`, so the callback identifies the exact attempt
-- and a duplicate reference can never occur.
--
-- Link events are the merchant-facing engagement trail: opened, term changed,
-- pay clicked, document downloaded. IP addresses are stored hashed.
--
-- Callbacks are recorded raw before anything else happens to them, valid
-- signature or not, so a disputed payment can be replayed from what the
-- gateway actually sent.
--
-- Forward-only, idempotent, no foreign keys (matching 027 onward).

CREATE TABLE IF NOT EXISTS renewal_payment_sessions (
  id                    BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  invoice_id            BIGINT UNSIGNED NOT NULL,
  -- 1, 2, 3… per invoice. Part of the gateway reference code.
  session_sequence      INT NOT NULL,
  reference_code        VARCHAR(50) NOT NULL,

  -- What was sent: the amount and term at the moment of the attempt, so a
  -- later term change cannot rewrite what the gateway was asked to collect.
  currency_code         CHAR(3) NOT NULL DEFAULT 'MYR',
  amount                DECIMAL(12,2) NOT NULL,
  billing_plan          ENUM('annually','bi_annually') NOT NULL,
  payment_email         VARCHAR(255) DEFAULT NULL,

  -- What came back.
  cap_session_number    VARCHAR(64) DEFAULT NULL,
  cap_transaction_number VARCHAR(64) DEFAULT NULL,
  redirect_url          TEXT DEFAULT NULL,

  status                ENUM('created','payment_pending','paid','failed',
                             'expired','cancelled','superseded')
                          NOT NULL DEFAULT 'created',
  -- Gateway status code from the last callback or query, verbatim.
  gateway_status_code   INT DEFAULT NULL,
  expires_at            DATETIME(3) DEFAULT NULL,
  last_queried_at       DATETIME(3) DEFAULT NULL,
  paid_at               DATETIME(3) DEFAULT NULL,

  ip_hash               CHAR(64) DEFAULT NULL,
  user_agent            VARCHAR(255) DEFAULT NULL,
  request_json          JSON DEFAULT NULL,
  response_json         JSON DEFAULT NULL,
  failure_message       VARCHAR(500) DEFAULT NULL,

  created_at            DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at            DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
                          ON UPDATE CURRENT_TIMESTAMP(3),

  UNIQUE KEY renewal_payment_sessions_seq_uk (invoice_id, session_sequence),
  UNIQUE KEY renewal_payment_sessions_ref_uk (reference_code),
  INDEX renewal_payment_sessions_status_idx (status, expires_at),
  INDEX renewal_payment_sessions_cap_idx (cap_session_number),
  INDEX renewal_payment_sessions_txn_idx (cap_transaction_number)
);

CREATE TABLE IF NOT EXISTS renewal_link_events (
  id                    BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  invoice_id            BIGINT UNSIGNED NOT NULL,
  event_type            ENUM('opened','term_changed','pay_clicked',
                             'pdf_downloaded','receipt_viewed')
                          NOT NULL,
  ip_hash               CHAR(64) DEFAULT NULL,
  user_agent            VARCHAR(255) DEFAULT NULL,
  payload_json          JSON DEFAULT NULL,
  created_at            DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  INDEX renewal_link_events_invoice_idx (invoice_id, created_at)
);

CREATE TABLE IF NOT EXISTS renewal_payment_callbacks (
  id                    BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  received_at           DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  -- The body exactly as received, before parsing. This is the evidence.
  raw_body              MEDIUMTEXT NOT NULL,
  presented_signature   VARCHAR(128) DEFAULT NULL,
  signature_valid       TINYINT(1) NOT NULL DEFAULT 0,

  reference_code        VARCHAR(50) DEFAULT NULL,
  cap_session_number    VARCHAR(64) DEFAULT NULL,
  cap_transaction_number VARCHAR(64) DEFAULT NULL,
  gateway_status_code   INT DEFAULT NULL,
  amount                DECIMAL(12,2) DEFAULT NULL,
  currency_code         CHAR(3) DEFAULT NULL,

  -- What SIMS did with it.
  outcome               ENUM('accepted','duplicate','rejected_signature',
                             'unmatched','amount_mismatch','ignored_status',
                             'error')
                          DEFAULT NULL,
  session_id            BIGINT UNSIGNED DEFAULT NULL,
  processed_at          DATETIME(3) DEFAULT NULL,
  note                  VARCHAR(500) DEFAULT NULL,

  INDEX renewal_payment_callbacks_ref_idx (reference_code),
  INDEX renewal_payment_callbacks_txn_idx (cap_transaction_number),
  INDEX renewal_payment_callbacks_received_idx (received_at)
);
