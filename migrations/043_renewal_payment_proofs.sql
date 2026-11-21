-- 043: proof of payment for renewals paid outside the gateway.
--
-- "Mark paid offline" recorded a bank reference and a note, and nothing a
-- second person could check them against. Staff can now attach the bank
-- slip, transfer screenshot or remittance PDF the merchant sent, when
-- recording the payment or afterwards.
--
-- The files live in MinIO under renewal-payment-proofs/, a prefix outside
-- OBJECT_KEY_PREFIXES like the invoice PDFs, so the generic upload proxy can
-- never serve them: only the invoice's own route, behind the invoice access
-- keys. Rows are never deleted; a wrong file is removed with deleted_at so
-- the audit trail keeps who attached and who removed it.
--
-- Forward-only and idempotent.

CREATE TABLE IF NOT EXISTS renewal_payment_proofs (
  id                   BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  invoice_id           BIGINT UNSIGNED NOT NULL,
  object_key           VARCHAR(512) NOT NULL,
  original_name        VARCHAR(255) NOT NULL,
  content_type         VARCHAR(120) NOT NULL,
  size_bytes           INT UNSIGNED NOT NULL,
  uploaded_by_user_id  BIGINT DEFAULT NULL,
  uploaded_at          DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  deleted_at           DATETIME(3) DEFAULT NULL,
  deleted_by_user_id   BIGINT DEFAULT NULL,

  UNIQUE KEY renewal_payment_proofs_key_uk (object_key),
  INDEX renewal_payment_proofs_invoice_idx (invoice_id, deleted_at)
);
