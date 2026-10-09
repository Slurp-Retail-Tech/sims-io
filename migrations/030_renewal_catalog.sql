-- =============================================================================
-- Migration: 030_renewal_catalog.sql
-- Target DB: sims-platform (MySQL 8.x)
-- Run as:    mysql -u user -p <db> < migrations/030_renewal_catalog.sql
--
-- Purpose:
--   Phase 1 of the renewal lifecycle: a reusable subscription plan catalog,
--   plan assignment at outlet and franchise scope, and the SIMS-owned
--   subscription projection that finally gives `valid_until` a home.
--
--   Until now `valid_until` existed only inside merchant_outlets.raw_payload,
--   which the nightly POS import rewrites wholesale (see merchant-import.ts,
--   `raw_payload = VALUES(raw_payload)`). Nothing SIMS wrote there could
--   survive an import, so SIMS could not be the system of record for an
--   expiry date it is now expected to extend on payment. outlet_subscriptions
--   is that record: seeded from the POS payload on first sight of an outlet,
--   owned by SIMS thereafter, and pushed back to POS on renewal.
--
-- Notes:
--   Deliberately no foreign keys, matching 027 and 028. This sidesteps the
--   BIGINT signedness divergence between schema.sql and production, so these
--   tables are byte-identical in both database shapes. Referential integrity
--   is enforced in application code.
--
--   franchise_id / outlet_id are VARCHAR business keys with no FK, exactly as
--   contact_outlets declares them (024). merchant_outlets.external_id alone is
--   not unique -- only (merchant_external_id, external_id) is -- so an outlet
--   is not a valid FK target. outlet_id NULL on an assignment means "every
--   outlet under this franchise", the same convention contact_outlets uses.
--
--   *_by_user_id columns are signed BIGINT to match the deployed users.id,
--   which drifted to signed. See README.
--
--   Soft-delete uniqueness uses a STORED generated column rather than adding
--   deleted_at to the unique key. A unique index permits unlimited rows when
--   any indexed column is NULL, so UNIQUE(plan_code, deleted_at) would NOT
--   stop two live plans sharing a code. Collapsing to NULL when deleted does.
--
--   These tables are intentionally NOT added to schema.sql. CI loads
--   schema.sql as the semantic state at 025 and baselines through 025, so
--   anything added there would assert a state that never existed.
--
--   Pure CREATE TABLE IF NOT EXISTS plus one idempotent seed, which is what
--   makes this trivially safe under `migrate.mjs verify-idempotent`.
--
-- Rollback:
--   DROP TABLE renewal_settings, renewal_franchise_settings,
--     outlet_subscriptions, subscription_plan_assignments, subscription_plans;
-- =============================================================================

-- -----------------------------------------------------------------------------
-- The catalog. A plan is defined once and assigned to many outlets or
-- franchises. Both term prices live on the same row: the term the merchant
-- selects at renewal decides which applies, so a plan is never duplicated per
-- term. Either price may be NULL, in which case that term is simply not
-- offered to merchants on that plan.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS subscription_plans (
  id                 BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,

  plan_code          VARCHAR(64) NOT NULL,
  plan_name          VARCHAR(255) NOT NULL,
  license_plan       ENUM('essential','meal','premium','feast') NOT NULL,

  price_annually     DECIMAL(12,2) DEFAULT NULL,
  price_bi_annually  DECIMAL(12,2) DEFAULT NULL,
  currency_code      CHAR(3) NOT NULL DEFAULT 'MYR',

  description        TEXT DEFAULT NULL,

  -- Deactivated rather than deleted while assignments reference it:
  -- existing assignments and issued invoices are unaffected, but the plan
  -- cannot be picked for a new assignment.
  is_active          TINYINT(1) NOT NULL DEFAULT 1,

  created_by_user_id BIGINT DEFAULT NULL,
  created_at         DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at         DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
                       ON UPDATE CURRENT_TIMESTAMP(3),
  deleted_at         DATETIME(3) DEFAULT NULL,

  -- Unique plan_code among live rows only; see the header note on NULLs.
  plan_code_guard    VARCHAR(64)
                       GENERATED ALWAYS AS (
                         IF(deleted_at IS NULL, plan_code, NULL)
                       ) STORED,

  UNIQUE KEY subscription_plans_code_uk (plan_code_guard),
  INDEX subscription_plans_live_idx (deleted_at, is_active, plan_name)
);

-- -----------------------------------------------------------------------------
-- Plan assignment. Two scopes:
--   outlet    -> franchise_id + outlet_id, that outlet only
--   franchise -> franchise_id, outlet_id NULL, every outlet in the franchise
--
-- Resolution is computed at read time, never copied onto the outlet, so an
-- outlet imported from the POS API after a franchise-wide assignment was made
-- inherits it with no further action.
--
-- "Only one active assignment per scope" is enforced in the application layer,
-- consistent with the Contacts module: MySQL does not treat outlet_id NULL as
-- a distinct value in a unique constraint, so the database cannot express it.
-- An outlet-scope and a franchise-scope assignment covering the same outlet
-- are valid and expected; the outlet-scope one wins.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS subscription_plan_assignments (
  id                          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,

  plan_id                     BIGINT UNSIGNED NOT NULL,
  scope                       ENUM('outlet','franchise') NOT NULL,
  franchise_id                VARCHAR(120) NOT NULL,
  outlet_id                   VARCHAR(120) DEFAULT NULL,

  -- A permanent departure from the catalog price, in either direction,
  -- applying every cycle until the assignment changes. Not a discount unless
  -- it happens to be one; override_direction records which it is.
  override_price_annually     DECIMAL(12,2) DEFAULT NULL,
  override_price_bi_annually  DECIMAL(12,2) DEFAULT NULL,
  override_reason             TEXT DEFAULT NULL,
  override_direction          ENUM('increase','decrease') DEFAULT NULL,

  default_billing_plan        ENUM('annually','bi_annually') NOT NULL DEFAULT 'annually',

  -- An override varying beyond the configured threshold needs approval. Until
  -- approved the assignment does not resolve for pricing at all, so the outlet
  -- lands in Actions Required rather than being invoiced at a price nobody
  -- signed off.
  approval_status             ENUM('not_required','pending','approved','rejected')
                                NOT NULL DEFAULT 'not_required',
  approved_by_user_id         BIGINT DEFAULT NULL,
  approved_at                 DATETIME(3) DEFAULT NULL,

  effective_from              DATE DEFAULT NULL,
  effective_to                DATE DEFAULT NULL,

  -- A replacement supersedes rather than deletes, so the price an old invoice
  -- was raised at stays explainable.
  superseded_by_assignment_id BIGINT UNSIGNED DEFAULT NULL,
  is_active                   TINYINT(1) NOT NULL DEFAULT 1,

  created_by_user_id          BIGINT DEFAULT NULL,
  created_at                  DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at                  DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
                                ON UPDATE CURRENT_TIMESTAMP(3),
  deleted_at                  DATETIME(3) DEFAULT NULL,

  -- Resolution reads this index: live rows for a franchise, both scopes at
  -- once, outlet-scope preferred in application code.
  INDEX subscription_plan_assignments_scope_idx
    (franchise_id, outlet_id, is_active, deleted_at),
  INDEX subscription_plan_assignments_plan_idx (plan_id, is_active, deleted_at),
  INDEX subscription_plan_assignments_approval_idx
    (approval_status, deleted_at, id)
);

-- -----------------------------------------------------------------------------
-- The subscription projection: one row per outlet, and the SIMS-owned record
-- of when its licence expires.
--
-- valid_until is seeded from merchant_outlets.raw_payload the first time the
-- sync job sees an outlet, and is never overwritten by the import again. After
-- that only a confirmed payment, an offline mark-paid, or a deliberate manual
-- correction moves it -- and each of those pushes the new date back to the POS
-- API so the two agree.
--
-- pos_valid_until keeps the last value the import reported, purely so drift is
-- detectable. Where POS runs ahead of SIMS somebody renewed outside SIMS, and
-- the sync raises that for a human rather than silently picking a winner.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS outlet_subscriptions (
  id                    BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,

  franchise_id          VARCHAR(120) NOT NULL,
  outlet_id             VARCHAR(120) NOT NULL,

  -- No source in SIMS today; the 2026 renewal workbook is the expected origin
  -- and is a separate workstream. Nullable until then.
  central_id            VARCHAR(120) DEFAULT NULL,

  company_name          VARCHAR(255) DEFAULT NULL,
  outlet_name           VARCHAR(255) DEFAULT NULL,

  valid_until           DATETIME(3) DEFAULT NULL,
  -- Grouped invoicing keys on franchise_id + this date, so it is stored and
  -- indexed rather than derived per query.
  valid_until_date      DATE
                          GENERATED ALWAYS AS (DATE(valid_until)) STORED,
  valid_until_source    ENUM('pos_seed','sims_extension','manual')
                          NOT NULL DEFAULT 'pos_seed',
  last_extended_at      DATETIME(3) DEFAULT NULL,

  -- Last value seen from the POS import. Drift detection only; never
  -- authoritative once SIMS has extended.
  pos_valid_until       DATETIME(3) DEFAULT NULL,
  pos_synced_at         DATETIME(3) DEFAULT NULL,

  current_billing_plan  ENUM('annually','bi_annually') DEFAULT NULL,

  -- Reseller-billed subscriptions are invoiced by the reseller, never by
  -- Slurp. Excluded from generation, dispatch, and revenue metrics.
  billed_by             ENUM('slurp','reseller') NOT NULL DEFAULT 'slurp',
  reseller_name         VARCHAR(255) DEFAULT NULL,

  billing_hold          TINYINT(1) NOT NULL DEFAULT 0,
  hold_reason           TEXT DEFAULT NULL,

  renewal_state         ENUM('not_due','reminder_sent','awaiting_payment','renewed',
                             'non_renewed','on_hold','action_required')
                          NOT NULL DEFAULT 'not_due',
  renewal_state_reason  VARCHAR(255) DEFAULT NULL,

  -- Mirrors merchant_outlets.status, so a closed outlet stops being chased.
  status                VARCHAR(60) DEFAULT NULL,
  is_active             TINYINT(1) NOT NULL DEFAULT 1,

  created_at            DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at            DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
                          ON UPDATE CURRENT_TIMESTAMP(3),
  deleted_at            DATETIME(3) DEFAULT NULL,

  UNIQUE KEY outlet_subscriptions_outlet_uk (franchise_id, outlet_id),
  -- The nightly detector's query: who expires on an offset date, still live,
  -- still billed by Slurp.
  INDEX outlet_subscriptions_due_idx
    (valid_until_date, is_active, billed_by, billing_hold),
  INDEX outlet_subscriptions_group_idx (franchise_id, valid_until_date),
  INDEX outlet_subscriptions_state_idx (renewal_state, valid_until_date)
);

-- -----------------------------------------------------------------------------
-- Per-franchise renewal settings. Grouped invoicing is opt-in here: with it on,
-- every eligible outlet in the franchise sharing a valid_until is billed on one
-- invoice with one line per outlet.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS renewal_franchise_settings (
  id                    BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,

  franchise_id          VARCHAR(120) NOT NULL,
  group_invoice_enabled TINYINT(1) NOT NULL DEFAULT 0,
  default_billing_plan  ENUM('annually','bi_annually') DEFAULT NULL,
  billing_hold          TINYINT(1) NOT NULL DEFAULT 0,
  notes                 TEXT DEFAULT NULL,

  updated_by_user_id    BIGINT DEFAULT NULL,
  created_at            DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at            DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
                          ON UPDATE CURRENT_TIMESTAMP(3),

  UNIQUE KEY renewal_franchise_settings_franchise_uk (franchise_id)
);

-- -----------------------------------------------------------------------------
-- Module settings, as a single pinned row with typed columns.
--
-- Deliberately not the key/value shape the PRD sketches: every other settings
-- table in this codebase is a singleton row (support_form_settings,
-- lead_notification_settings, respondio_settings), and typed columns mean a tax
-- rate is a DECIMAL rather than a string somebody has to parse and trust.
--
-- dispatch_enabled ships OFF. Phase 3 runs the whole detection and invoicing
-- pipeline with it off, so the coverage gap surfaces in Actions Required before
-- any merchant is contacted.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS renewal_settings (
  id                              INT NOT NULL PRIMARY KEY,

  -- Days before valid_until at which reminders fire. JSON so the cadence is a
  -- settings change, not a schema change.
  reminder_offsets_json           JSON DEFAULT NULL,
  default_billing_plan            ENUM('annually','bi_annually') NOT NULL DEFAULT 'annually',

  -- Exclusive: calculated on the subtotal and added to it, never treated as
  -- already contained in the plan price. Slurp is not SST-registered, so this
  -- is 0 and the tax line is suppressed on documents while it stays 0.
  tax_rate                        DECIMAL(5,2) NOT NULL DEFAULT 0.00,

  -- Absolute variance from the catalog price, in percent, beyond which an
  -- override needs approval. Applies to increases and reductions alike.
  override_variance_threshold_pct DECIMAL(5,2) NOT NULL DEFAULT 15.00,

  -- Days after valid_until that the renewal link stays payable. A payment
  -- inside the window still extends from the original expiry.
  grace_window_days               INT NOT NULL DEFAULT 30,

  -- Global kill switch for outbound messaging. Invoices, PDFs and payment
  -- links are still generated while this is off.
  dispatch_enabled                TINYINT(1) NOT NULL DEFAULT 0,
  send_window_start               TIME NOT NULL DEFAULT '09:00:00',
  send_window_end                 TIME NOT NULL DEFAULT '18:00:00',

  -- CommercePay session lifetime, in minutes. 24 hours.
  session_expiry_minutes          INT NOT NULL DEFAULT 1440,
  max_session_retries             INT NOT NULL DEFAULT 3,

  -- Seconds the receipt page keeps polling before telling the merchant the
  -- documents will follow by message.
  receipt_poll_ceiling_seconds    INT NOT NULL DEFAULT 90,

  respondio_whatsapp_channel_id   VARCHAR(64) DEFAULT NULL,
  bukku_description_format        VARCHAR(255) DEFAULT NULL,

  updated_by_user_id              BIGINT DEFAULT NULL,
  updated_at                      DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
                                    ON UPDATE CURRENT_TIMESTAMP(3)
);

-- Seed the singleton. Idempotent: a re-run touches nothing, and an existing
-- row keeps whatever the settings page has since changed it to.
INSERT INTO renewal_settings (id, reminder_offsets_json)
VALUES (1, CAST('[15, 5, 1]' AS JSON))
ON DUPLICATE KEY UPDATE id = VALUES(id);
