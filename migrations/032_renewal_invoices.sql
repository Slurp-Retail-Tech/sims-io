-- =============================================================================
-- Migration: 032_renewal_invoices.sql
-- Target DB: sims-platform (MySQL 8.x)
-- Run as:    mysql -u user -p <db> < migrations/032_renewal_invoices.sql
--
-- Purpose:
--   Phase 3 of the renewal lifecycle: the documents themselves, the queue of
--   things that stop one being raised, and the audit trail of every state
--   change.
--
--   A proforma is raised at the first reminder offset and reused at the later
--   ones. On confirmed payment it is superseded by a tax invoice carrying its
--   own number and linked back by parent_invoice_id, so the two series stay
--   separate and only the tax invoice counts as revenue.
--
-- Notes:
--   *** ONE OPEN PROFORMA PER GROUP ***
--   The PRD specifies UNIQUE (group_key, document_type, deleted_at) as the
--   guarantee. That does NOT hold. A unique index permits unlimited rows when
--   any indexed column is NULL, and a live invoice has deleted_at NULL, so two
--   concurrent nightly runs could both insert. `open_guard` is a STORED
--   generated column that collapses to NULL once the row is soft-deleted,
--   which gives the constraint real teeth. Same technique as 030 uses for
--   plan_code.
--
--   *** INVOICE NUMBERING ***
--   renewal_invoice_sequences exists because allocating PI-{YYYY}/{MM}-{NNN}
--   by reading MAX() under a plain unique constraint degrades into a retry
--   loop the moment two runs allocate at once. The counter row is locked
--   FOR UPDATE inside the same transaction that inserts the invoice.
--
--   Amounts are DECIMAL(12,2) in MYR. Conversion to CommercePay's integer
--   minor units happens only at the gateway call, never in the database.
--
--   Tax is EXCLUSIVE: tax_amount is calculated on subtotal_amount and added to
--   it. Never treat a plan price as tax-inclusive. The rate is 0 while Slurp
--   is not SST-registered, and the tax line is suppressed on the document
--   while it is.
--
--   Deliberately no foreign keys, matching 027, 028 and 030.
--   Not added to schema.sql; CI baselines that file at 025.
--
-- Rollback:
--   DROP TABLE renewal_actions_required, renewal_invoice_events,
--     renewal_invoice_sequences, renewal_invoice_items, renewal_invoices;
-- =============================================================================

CREATE TABLE IF NOT EXISTS renewal_invoices (
  id                    BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,

  invoice_number        VARCHAR(32) NOT NULL,
  document_type         ENUM('proforma','tax_invoice') NOT NULL DEFAULT 'proforma',
  -- Set on a tax invoice, pointing at the proforma it settles.
  parent_invoice_id     BIGINT UNSIGNED DEFAULT NULL,

  franchise_id          VARCHAR(120) NOT NULL,
  company_name          VARCHAR(255) DEFAULT NULL,

  -- franchise_id + the shared valid_until date. Deterministic and
  -- re-derivable, so a re-run recognises the group it already invoiced.
  group_key             VARCHAR(191) NOT NULL,
  is_grouped            TINYINT(1) NOT NULL DEFAULT 0,

  -- The renewal PIC this was addressed to, resolved at generation time.
  contact_id            BIGINT DEFAULT NULL,

  billing_plan_selected ENUM('annually','bi_annually') DEFAULT NULL,
  term_months           INT DEFAULT NULL,

  period_start          DATE DEFAULT NULL,
  period_end            DATE DEFAULT NULL,
  issue_date            DATE DEFAULT NULL,
  due_date              DATE DEFAULT NULL,

  currency_code         CHAR(3) NOT NULL DEFAULT 'MYR',
  subtotal_amount       DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  -- Sum of line adjustments: negative for reductions, positive for increases.
  -- Never netted in reporting; stored signed so both can be recovered.
  adjustment_amount     DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  tax_rate              DECIMAL(5,2) NOT NULL DEFAULT 0.00,
  tax_amount            DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  total_amount          DECIMAL(12,2) NOT NULL DEFAULT 0.00,

  -- Where the receipt and tax invoice are emailed. Captured on the proforma
  -- page and passed to CommercePay, because the gateway returns no payer
  -- email on the callback or on a query.
  payment_email         VARCHAR(255) DEFAULT NULL,
  payer_respondio_contact_id VARCHAR(64) DEFAULT NULL,

  status                ENUM('draft','issued','sent','payment_pending','paid',
                             'lapsed','cancelled','superseded')
                          NOT NULL DEFAULT 'draft',

  -- The merchant-facing link. Cryptographically random and unguessable; one
  -- token serves both the proforma page and the receipt page.
  renewal_token         CHAR(43) DEFAULT NULL,
  term_locked_at        DATETIME(3) DEFAULT NULL,

  pdf_object_key        VARCHAR(512) DEFAULT NULL,
  receipt_pdf_object_key VARCHAR(512) DEFAULT NULL,

  -- Engagement. first_opened_at is stamped once; open_count counts every visit.
  first_opened_at       DATETIME(3) DEFAULT NULL,
  open_count            INT UNSIGNED NOT NULL DEFAULT 0,

  paid_at               DATETIME(3) DEFAULT NULL,
  paid_via              ENUM('commercepay','manual') DEFAULT NULL,
  cap_transaction_number VARCHAR(64) DEFAULT NULL,

  -- Extension is separate from payment: the money is never in question even
  -- when the licence date fails to move.
  extension_status      ENUM('not_applicable','pending','applied','failed')
                          NOT NULL DEFAULT 'not_applicable',
  -- Whether the new date reached the POS API. Failure here never rolls back
  -- the payment or the SIMS-side extension.
  pos_push_status       ENUM('not_applicable','pending','pushed','failed')
                          NOT NULL DEFAULT 'not_applicable',

  bukku_export_id       BIGINT UNSIGNED DEFAULT NULL,
  bukku_exported_at     DATETIME(3) DEFAULT NULL,

  -- Outlets left out of a grouped invoice, with why, so the total is
  -- explainable without reconstructing the run.
  excluded_outlets_json JSON DEFAULT NULL,

  created_by_user_id    BIGINT DEFAULT NULL,
  created_at            DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at            DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
                          ON UPDATE CURRENT_TIMESTAMP(3),
  deleted_at            DATETIME(3) DEFAULT NULL,

  -- See the header note. This, not (group_key, document_type, deleted_at), is
  -- what makes invoice generation idempotent.
  open_guard            VARCHAR(255)
                          GENERATED ALWAYS AS (
                            IF(deleted_at IS NULL,
                               CONCAT(group_key, '|', document_type),
                               NULL)
                          ) STORED,
  invoice_number_guard  VARCHAR(32)
                          GENERATED ALWAYS AS (
                            IF(deleted_at IS NULL, invoice_number, NULL)
                          ) STORED,

  UNIQUE KEY renewal_invoices_open_guard_uk (open_guard),
  UNIQUE KEY renewal_invoices_number_uk (invoice_number_guard),
  UNIQUE KEY renewal_invoices_token_uk (renewal_token),
  INDEX renewal_invoices_status_idx (status, due_date),
  INDEX renewal_invoices_franchise_idx (franchise_id, deleted_at),
  INDEX renewal_invoices_parent_idx (parent_invoice_id),
  INDEX renewal_invoices_paid_idx (status, paid_at)
);

CREATE TABLE IF NOT EXISTS renewal_invoice_items (
  id                    BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  invoice_id            BIGINT UNSIGNED NOT NULL,
  outlet_subscription_id BIGINT UNSIGNED DEFAULT NULL,

  -- The full triplet on every line, never central_id or outlet_id alone:
  -- both are unique only within their franchise.
  franchise_id          VARCHAR(120) NOT NULL,
  outlet_id             VARCHAR(120) NOT NULL,
  central_id            VARCHAR(120) DEFAULT NULL,
  outlet_name           VARCHAR(255) DEFAULT NULL,

  plan_id               BIGINT UNSIGNED DEFAULT NULL,
  assignment_id         BIGINT UNSIGNED DEFAULT NULL,
  license_plan          VARCHAR(40) DEFAULT NULL,
  billing_plan          ENUM('annually','bi_annually') NOT NULL DEFAULT 'annually',

  -- catalog_amount is what the override is measured against, which is the
  -- assignment price where one exists rather than always the plan's own list
  -- price. effective_amount is what the merchant is charged.
  catalog_amount        DECIMAL(12,2) DEFAULT NULL,
  effective_amount      DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  adjustment_amount     DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  -- Which rule produced effective_amount, so any figure is explainable
  -- without re-deriving it against prices that may since have changed.
  price_source          ENUM('catalog','assignment_override','cycle_override')
                          NOT NULL DEFAULT 'catalog',

  cycle_override_amount DECIMAL(12,2) DEFAULT NULL,
  cycle_override_reason TEXT DEFAULT NULL,
  cycle_override_approved_by_user_id BIGINT DEFAULT NULL,
  cycle_override_approved_at DATETIME(3) DEFAULT NULL,

  line_amount           DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  tax_rate              DECIMAL(5,2) NOT NULL DEFAULT 0.00,

  previous_valid_until  DATETIME(3) DEFAULT NULL,
  new_valid_until       DATETIME(3) DEFAULT NULL,

  sort_order            INT NOT NULL DEFAULT 0,
  created_at            DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at            DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
                          ON UPDATE CURRENT_TIMESTAMP(3),

  -- One line per outlet per invoice. Makes re-pricing on a term change an
  -- update rather than a risk of duplicate lines.
  UNIQUE KEY renewal_invoice_items_outlet_uk (invoice_id, franchise_id, outlet_id),
  INDEX renewal_invoice_items_invoice_idx (invoice_id, sort_order),
  INDEX renewal_invoice_items_subscription_idx (outlet_subscription_id)
);

-- -----------------------------------------------------------------------------
-- Per-series, per-month counters for PI-{YYYY}/{MM}-{NNN} and
-- INV-{YYYY}/{MM}-{NNN}.
--
-- Locked FOR UPDATE inside the invoice's own transaction, so two concurrent
-- runs queue rather than collide. Reading MAX(invoice_number) instead would
-- make every concurrent allocation a retry.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS renewal_invoice_sequences (
  id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  series       ENUM('PI','INV') NOT NULL,
  period_year  SMALLINT UNSIGNED NOT NULL,
  period_month TINYINT UNSIGNED NOT NULL,
  next_value   INT UNSIGNED NOT NULL DEFAULT 1,
  updated_at   DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
                 ON UPDATE CURRENT_TIMESTAMP(3),

  UNIQUE KEY renewal_invoice_sequences_period_uk (series, period_year, period_month)
);

-- -----------------------------------------------------------------------------
-- Every status transition and manual action, with who did it.
-- `system` where a scheduled job did it rather than a person.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS renewal_invoice_events (
  id             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  invoice_id     BIGINT UNSIGNED NOT NULL,
  event_type     VARCHAR(64) NOT NULL,
  actor_user_id  BIGINT DEFAULT NULL,
  payload_json   JSON DEFAULT NULL,
  created_at     DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  INDEX renewal_invoice_events_invoice_idx (invoice_id, created_at),
  INDEX renewal_invoice_events_type_idx (event_type, created_at)
);

-- -----------------------------------------------------------------------------
-- Everything that stops a renewal being carried through, with the reason.
--
-- An entry auto-resolves on the next nightly run once the gap closes, so the
-- queue reflects the present rather than a history of everything that was ever
-- wrong. occurrence_count and days_to_expiry let it sort by urgency rather
-- than by age.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS renewal_actions_required (
  id                BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,

  franchise_id      VARCHAR(120) NOT NULL,
  outlet_id         VARCHAR(120) DEFAULT NULL,
  central_id        VARCHAR(120) DEFAULT NULL,
  invoice_id        BIGINT UNSIGNED DEFAULT NULL,

  reason            VARCHAR(64) NOT NULL,
  detail            TEXT DEFAULT NULL,
  -- Informational entries do not block invoicing; blocking ones do.
  severity          ENUM('blocking','informational') NOT NULL DEFAULT 'blocking',

  days_to_expiry    INT DEFAULT NULL,
  occurrence_count  INT UNSIGNED NOT NULL DEFAULT 1,

  status            ENUM('open','resolved','dismissed') NOT NULL DEFAULT 'open',
  first_detected_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  last_detected_at  DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  resolved_at       DATETIME(3) DEFAULT NULL,
  resolved_by_user_id BIGINT DEFAULT NULL,
  dismiss_reason    TEXT DEFAULT NULL,

  created_at        DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at        DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
                      ON UPDATE CURRENT_TIMESTAMP(3),

  -- One open entry per scope per reason. Collapses to NULL once resolved or
  -- dismissed, so the same gap reappearing later opens a fresh entry rather
  -- than resurrecting a closed one.
  open_guard        VARCHAR(255)
                      GENERATED ALWAYS AS (
                        IF(status = 'open',
                           CONCAT(franchise_id, '|', COALESCE(outlet_id, '*'),
                                  '|', reason),
                           NULL)
                      ) STORED,

  UNIQUE KEY renewal_actions_required_open_uk (open_guard),
  INDEX renewal_actions_required_queue_idx (status, days_to_expiry, id),
  INDEX renewal_actions_required_reason_idx (status, reason),
  INDEX renewal_actions_required_scope_idx (franchise_id, outlet_id, status)
);
