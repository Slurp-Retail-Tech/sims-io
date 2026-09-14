## SIMS

SIMS is an internal Next.js App Router workspace for Support, Sales, Merchant Success, Renewal & Retention, merchant operations, and related back-office workflows.

The current production codebase is a single Next.js app at the repo root with:
- UI routes under `src/app/`
- API endpoints under `src/app/api/`
- shared business logic under `src/lib/`
- shared components under `src/components/`
- database schema in `schema.sql`

The long-term product vision in `docs/PRD.md` and `docs/TDD.md` is broader than the current implementation. Those docs now distinguish between the current app and planned future architecture.

## Tech Stack

- Next.js 16 App Router
- React 19
- TypeScript 5
- Tailwind CSS 4
- MySQL with `mysql2`
- Redis (rate limiting)
- MinIO via AWS S3 SDK
- ClickUp API integration
- POS API integration
- Google Workspace integrations (SSO, Calendar sync with Meet invites, Places lookup, SMTP)
- Nodemailer for email delivery
- Mapbox GL for map views

## Current Product Areas

- Merchant Success — tickets, ticket history, SLA breaches, CSAT insights, audit trail, ticket categories, ClickUp task sync, onboarding appointments and schedule (Google Calendar sync, Google Maps locations), analytics
- Merchant directory, POS import, and PLUS merchant workflows
- Sales — leads (assignment, deals, activity logging), appointments with Google Calendar sync, invites, and Google Meet links, overview, and analytics. Lead Meeting activities can create linked sales appointments that stay in sync on edit, cancel, and delete
- Renewal & Retention — renewal due tracking and analytics overview
- User management, activation, reset-password, and Google Workspace SSO
- Public support and demo forms
- Merchant map and knowledge base
- Release notes

## Current Known Gaps

- Some dashboards are still UI previews or placeholder analytics.
- Renewal & Retention overview currently shows sample data only and is not live reporting.
- External messaging-channel integration from the PRD/TDD is not implemented in this app.
- Automated test coverage is focused on shared library helpers (`npm test` runs an explicit allowlist in `package.json`, not auto-discovery); route handlers and UI are largely untested.

## Getting Started

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to access the app.

## Environment Variables

Create `.env.local` at the repo root.

```
# ── Database ──────────────────────────────────────────────────────────────────
# Use DATABASE_URL (preferred) OR the individual MYSQL_* vars — not both.
DATABASE_URL=

MYSQL_HOST=127.0.0.1
MYSQL_PORT=3307
MYSQL_USER=sims
MYSQL_PASSWORD=sims-password
MYSQL_DATABASE=sims-local

# ── Redis (rate limiting) ─────────────────────────────────────────────────────
# Required in production. Falls back to in-memory store in development.
REDIS_URL=redis://localhost:6379
# Set to any non-empty value when running behind a trusted reverse proxy
# (e.g. Coolify, Nginx). Enables reading the real client IP from X-Forwarded-For.
TRUSTED_PROXY=

# ── MinIO / Object storage ────────────────────────────────────────────────────
MINIO_ENDPOINT=http://127.0.0.1:9000
# Public URL for browser-facing file links (may differ from internal endpoint)
MINIO_PUBLIC_URL=http://127.0.0.1:9000
MINIO_ACCESS_KEY=minioadmin
MINIO_SECRET_KEY=minioadmin
MINIO_BUCKET=attachments
MINIO_REGION=us-east-1

# ── App ───────────────────────────────────────────────────────────────────────
APP_BASE_URL=http://localhost:3000

# ── Google OAuth ──────────────────────────────────────────────────────────────
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
# Optional — defaults to ${APP_BASE_URL}/api/auth/google/callback
GOOGLE_REDIRECT_URI=
# Comma-separated list of allowed Google Workspace domains for SSO
GOOGLE_WORKSPACE_DOMAINS=

# ── Google Calendar sync (onboarding schedule & sales appointments) ──────────
GOOGLE_CALENDAR_ENABLED=false
GOOGLE_CALENDAR_ID=
# Optional dedicated calendar for sales appointments; falls back to GOOGLE_CALENDAR_ID.
GOOGLE_CALENDAR_SALES_ID=
GOOGLE_CALENDAR_CLIENT_ID=
GOOGLE_CALENDAR_CLIENT_SECRET=
GOOGLE_CALENDAR_REDIRECT_URI=
GOOGLE_CALENDAR_REFRESH_TOKEN=
# Local fallback only. Prefer OAuth refresh-token credentials above.
GOOGLE_CALENDAR_ACCESS_TOKEN=
GOOGLE_PLACES_ENABLED=false
GOOGLE_PLACES_API_KEY=
GOOGLE_PLACES_REGION_CODES=MY

# ── Email (Google Workspace SMTP) ─────────────────────────────────────────────
SMTP_HOST=smtp.gmail.com
SMTP_PORT=465
SMTP_SECURE=true
SMTP_USER=
SMTP_PASS=
SMTP_FROM_EMAIL=noreply@example.com
SMTP_FROM_NAME=SIMS

# ── POS API ───────────────────────────────────────────────────────────────────
POS_API_EMAIL=
POS_API_PASSWORD=
POS_AUTH_URL=
POS_API_BASE_URL=
POS_IMPORT_URL=
POS_BRANCH_URL=
POS_MERCHANT_ID_BASE_URL=
POS_CATEGORY_BUSINESS_BASE_URL=
MERCHANT_IMPORT_CRON_SECRET=

# ── ClickUp ───────────────────────────────────────────────────────────────────
CLICKUP_API_TOKEN=
CLICKUP_LIST_ID=
CLICKUP_API_BASE_URL=https://api.clickup.com/api/v2
CLICKUP_SYNC_CRON_SECRET=
NEXT_PUBLIC_CLICKUP_ENABLED=true
# Optional custom field mapping for ClickUp task request approvals
CLICKUP_CUSTOM_FIELD_PRODUCT_ID=
CLICKUP_CUSTOM_FIELD_PRODUCT_OPTION_MAP=
CLICKUP_CUSTOM_FIELD_DEPARTMENT_REQUEST_ID=
CLICKUP_CUSTOM_FIELD_DEPARTMENT_REQUEST_OPTION_MAP=
CLICKUP_CUSTOM_FIELD_OUTLET_NAME_ID=
CLICKUP_CUSTOM_FIELD_PIC_NAME_ID=
CLICKUP_CUSTOM_FIELD_PRIORITY_LEVEL_ID=
CLICKUP_CUSTOM_FIELD_PRIORITY_LEVEL_OPTION_MAP=
CLICKUP_CUSTOM_FIELD_SEVERITY_LEVEL_ID=
CLICKUP_CUSTOM_FIELD_SEVERITY_LEVEL_OPTION_MAP=

# ── Public forms ──────────────────────────────────────────────────────────────
NEXT_PUBLIC_SUPPORT_PHONE=
NEXT_PUBLIC_SUPPORT_EMAIL=
SUPPORTFORM_WHATSAPP_NUMBER=
DEMOFORM_WHATSAPP_NUMBER=

# ── reCAPTCHA (demo form bot protection) ─────────────────────────────────────
# Required in production — verification fails closed if secret is missing.
NEXT_PUBLIC_RECAPTCHA_SITE_KEY=
RECAPTCHA_SECRET_KEY=

# ── Google Tag Manager (optional) ────────────────────────────────────────────
# When set, the GTM container loads site-wide and the demo form pushes a
# `demo_form_submit` event to the dataLayer on success. Leave blank to disable.
NEXT_PUBLIC_GTM_ID=

# ── Meta (Facebook) Pixel (optional) ─────────────────────────────────────────
# When set, the base pixel loads site-wide (PageView) and the demo form fires a
# `Lead` conversion on success. Single source of the Lead event — do NOT also
# configure a Lead tag in GTM (double-counting). Numeric Pixel ID. Baked into
# the JS bundle at build time. Leave blank to disable.
NEXT_PUBLIC_META_PIXEL_ID=
# Conversions API (server-side pixel). When this token is set, the Lead
# conversion is also sent server-side so it survives ad blockers; deduplicated
# with the browser pixel via a shared event_id. Server-only secret — do NOT
# prefix with NEXT_PUBLIC. META_CAPI_TEST_EVENT_CODE is optional, for Test Events.
META_CAPI_ACCESS_TOKEN=
META_CAPI_TEST_EVENT_CODE=

# ── Lead WhatsApp button ──────────────────────────────────────────────────────
# Default country code for the "Open in WhatsApp" button in the lead-assigned
# email. Numbers starting with 0 are treated as local and the leading 0 is
# replaced with this code. Defaults to 60 (Malaysia) when unset.
LEAD_WHATSAPP_COUNTRY_CODE=60

# ── Mapbox ────────────────────────────────────────────────────────────────────
# Required for the /maps page. Baked into the client bundle at build time.
NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN=

# ── CSAT Google Review trigger ───────────────────────────────────────────────
# Company-wide Google review URL shown after a satisfied CSAT submission.
CSAT_GOOGLE_REVIEW_URL=

# ── Iframe embedding for public forms ────────────────────────────────────────
# Comma-separated origins allowed to embed /demoform and /supportform.
EMBED_ALLOWED_ORIGINS=

# Bootstrap shared secret for the Respond.io inbound webhook. Ignored once a secret is
# issued from General > Integrations.
RESPONDIO_WEBHOOK_SECRET=

# ── Respond.io outbound: CSAT link on ticket close ───────────────────────────
# n8n webhook that sends the CSAT survey link to the merchant. Unset = feature off.
RESPONDIO_CSAT_WEBHOOK_URL=
RESPONDIO_CSAT_WEBHOOK_SECRET=
```

Notes:
- `RESPONDIO_WEBHOOK_SECRET` — bootstrap only. It authenticates `POST /api/integrations/respond-io` while `respondio_integration_secrets` is empty; once a key is issued from **General → Integrations** the DB keys take over and this value is ignored. Issued secrets are stored as a sha256 hash and shown exactly once, so there is no way to recover one — rotate to get a new value.
- `RESPONDIO_CSAT_WEBHOOK_URL` / `RESPONDIO_CSAT_WEBHOOK_SECRET` — outbound: closing a Respond.io-sourced ticket sends the CSAT survey link back to the merchant's conversation. Leave the URL blank to disable the automatic send (the ticket page's manual share button is unaffected). The secret is sent as `x-sims-webhook-secret` to the n8n Header Auth credential and is **separate** from `RESPONDIO_WEBHOOK_SECRET`. Import `n8n/sims-csat-link-send.json` and follow `n8n/README.md`. `APP_BASE_URL` must be the public SIMS host, or the link SIMS builds is unreachable.
- `REDIS_URL` — required in production; in development, rate limiting falls back to an in-memory store
- `TRUSTED_PROXY=true` — set when running behind Coolify/Traefik; enables `X-Forwarded-For` reading for rate-limit IP derivation
- `MINIO_PUBLIC_URL` — set to the public-facing URL for MinIO when it differs from the internal `MINIO_ENDPOINT` (always the case in production behind a reverse proxy)
- MinIO object expiry — apply a 60-day lifecycle rule on the `uploads/` prefix after provisioning (avatars are exempt); see `docs/TDD.md` for the `mc ilm add` command
- `DATABASE_URL` takes precedence over individual `MYSQL_*` vars if both are set
- `APP_BASE_URL` — used in activation emails, password reset emails, and Google OAuth callbacks; must match the registered OAuth redirect URI exactly
- `GOOGLE_WORKSPACE_DOMAINS` — comma-separated allowlist of Google Workspace domains permitted for SSO login
- `GOOGLE_CALENDAR_ENABLED=true` syncs onboarding appointments to `GOOGLE_CALENDAR_ID`; configure `GOOGLE_CALENDAR_CLIENT_ID`, `GOOGLE_CALENDAR_CLIENT_SECRET`, and `GOOGLE_CALENDAR_REFRESH_TOKEN` so SIMS can refresh Calendar access tokens automatically
- Sales appointments sync to `GOOGLE_CALENDAR_SALES_ID` when set, falling back to `GOOGLE_CALENDAR_ID`; events are one hour long and are updated (not deleted) when an appointment is edited, canceled, or completed. Sales events invite the appointment creator (and any participant emails for Online meetings) and auto-create a Google Meet link for Online meetings
- `GOOGLE_CALENDAR_REDIRECT_URI` is optional; it defaults to `${APP_BASE_URL}/api/google-calendar/oauth/callback` for the one-time refresh-token helper flow
- `GOOGLE_CALENDAR_ACCESS_TOKEN` is a local fallback; access tokens expire, so do not use it as the production setup
- `GOOGLE_PLACES_ENABLED=true` enables server-side Google Places lookup for onboarding locations and sales meeting locations (lead Meeting activities and sales appointments); restrict `GOOGLE_PLACES_API_KEY` in Google Cloud and use `GOOGLE_PLACES_REGION_CODES` to bias supported countries
- `NEXT_PUBLIC_RECAPTCHA_SITE_KEY`, `NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN`, `NEXT_PUBLIC_GTM_ID`, and `NEXT_PUBLIC_META_PIXEL_ID` are baked into the JS bundle at build time; changing them requires a full redeploy, not just a container restart
- `RECAPTCHA_SECRET_KEY` — reCAPTCHA enforcement is fail-closed in production; the demo form POST returns 500 if this is missing
- `CSAT_GOOGLE_REVIEW_URL` — company-wide Google review link for Slurp Retail Tech Sdn Bhd; shown after a CSAT submission only when the Support Service rating is Satisfied/Very Satisfied. Leave blank to disable the review prompt entirely
- `EMBED_ALLOWED_ORIGINS` — comma-separated list of origins permitted to embed the public forms (`/demoform`, `/supportform`) in an iframe, applied via the CSP `frame-ancestors` directive (e.g. `https://www.getslurp.com,https://partner.example.com`). Leave blank to disable embedding — the forms then keep `X-Frame-Options: DENY` like every other route

## Google Workspace SMTP Setup

1. Create or choose a dedicated Google Workspace mailbox for SIMS outbound email.
2. Enable 2-Step Verification on that mailbox.
3. Generate an App Password for mail delivery and set it as `SMTP_PASS`.
4. Set `SMTP_USER` to the mailbox address and `SMTP_FROM_EMAIL` to the same mailbox or an allowed alias.
5. Optionally set `SMTP_FROM_NAME` for the display name shown in auth, lead notification, and onboarding schedule emails.

After deployment, verify:
- resend activation email from the user management page
- forgot-password flow
- onboarding schedule submission, approval, and completion notifications
- demo form lead notification delivery

## Google Calendar & Meet Setup

Calendar sync covers two features, both gated on `GOOGLE_CALENDAR_ENABLED=true`:

- **Onboarding appointments** → `GOOGLE_CALENDAR_ID`
- **Sales appointments** → `GOOGLE_CALENDAR_SALES_ID`, falling back to `GOOGLE_CALENDAR_ID` when unset

Setup:

1. Create (or choose) the target calendar(s) and note their calendar IDs.
2. Configure `GOOGLE_CALENDAR_CLIENT_ID` / `GOOGLE_CALENDAR_CLIENT_SECRET` for an OAuth client with the Calendar API enabled.
3. Run the one-time helper flow at `/api/google-calendar/oauth/start` with the Google account that should own the events, and store the resulting `GOOGLE_CALENDAR_REFRESH_TOKEN`.
4. The authorizing account must have **"Make changes and manage sharing"** access on the target calendars — sales events add attendees (invite emails via `sendUpdates=all`) and create Google Meet conferences, which fail without it.

Behavior notes:

- Events are updated in place — canceling or completing an appointment rewrites the event description rather than deleting the event.
- Sales events invite the appointment creator; Online sales appointments also invite the entered participant emails and auto-create a Google Meet link (stored and shown in SIMS).
- Sync is fail-open: calendar failures are recorded on the appointment row (`google_sync_status`, `google_sync_error`) and never block the API.
- Events created in SIMS show the authorizing account as the organizer; the SIMS user who created the appointment appears in the event description and as an attendee.

`GOOGLE_PLACES_ENABLED=true` (with `GOOGLE_PLACES_API_KEY`) additionally enables the Google Maps location picker used by onboarding scheduling, lead Meeting activities, and sales appointments. When disabled, sales locations fall back to free text.

## Database (Docker)

Start MySQL and phpMyAdmin with Docker:

```
docker compose up -d
```

Defaults:
- MySQL runs on `localhost:3307` (host port mapped from container 3306) with database `sims-local` and user `sims`/`sims-password`.
- phpMyAdmin is at `http://localhost:8081` (server: `mysql`, user: `sims`, password: `sims-password`).
- MinIO API is at `http://localhost:9002`, console at `http://localhost:9003`.

The schema file at `schema.sql` is loaded automatically the first time the container starts. If you need to re-run it, delete the `mysql_data` volume and restart.

## Merchant Import

Manual import runs from the Merchants page and pulls data from the POS API.

Scheduled import is handled by your platform scheduler (for example, Coolify).
See `docs/scheduler.md` for a ready-to-use setup, including cron timing in
Asia/Kuala_Lumpur, one-line Coolify command examples, and the
`MERCHANT_IMPORT_CRON_SECRET` header secret.

## ClickUp Integration

Ticket detail now supports:
- `Create task`: creates a ClickUp task from ticket data.
- `Refresh status`: fetches the latest ClickUp task status manually.
- `Link task`: links an existing ClickUp task URL.

Required environment variables:
- `CLICKUP_API_TOKEN`
- `CLICKUP_LIST_ID`

Optional:
- `CLICKUP_API_BASE_URL` (defaults to `https://api.clickup.com/api/v2`)
- `NEXT_PUBLIC_CLICKUP_ENABLED` (`true` by default)

For daily automatic status refresh, schedule:
- `POST /api/clickup/sync`

Use header:
- `x-cron-secret: ${CLICKUP_SYNC_CRON_SECRET}`

When adding scheduler commands in Coolify, keep the command on one line and
quote the URL and header value to avoid shell parsing issues with secrets that
contain special characters.

## File Uploads (MinIO)

All file uploads should go through the shared API: `POST /api/uploads`.
See `docs/uploads.md` for request format and folder conventions.

This project relies on `schema.sql` for database updates. If you already have data in MySQL, back it up before reloading the schema.

## Renewal Overview Status

The Renewal & Retention overview page is currently a preview-only UI surface. It intentionally shows sample KPI cards and placeholder chart content until a live renewal analytics data source is connected.

## Deployment (Coolify)

The app deploys via Coolify from GitHub using the `Dockerfile` at the repo root.

**Services to create in Coolify (in order):**
1. MySQL 8.4 — internal hostname `sims-mysql`, port 3306
2. Redis 7 — internal hostname `sims-redis`, port 6379
3. MinIO — internal hostname `sims-minio`; expose the console on a subdomain; create the bucket manually after first start
4. Application — GitHub repo, Dockerfile buildpack, port 3000

**Key production env var differences from local dev:**
- `DATABASE_URL=mysql://user:pass@sims-mysql:3306/dbname`
- `REDIS_URL=redis://sims-redis:6379`
- `MINIO_ENDPOINT=http://sims-minio:9000` (internal)
- `MINIO_PUBLIC_URL=https://minio.yourdomain.com` (public, browser-facing)
- `TRUSTED_PROXY=true`
- `NODE_ENV=production`

**NEXT_PUBLIC_* vars** must be marked as "Build Variables" in Coolify's env editor so they are passed as Docker build args and baked into the JS bundle.

**Database migrations** are applied by the in-repo runner, `scripts/migrate.mjs`,
which records what ran where in a `schema_migrations` ledger (checksummed,
forward-only — there is deliberately no `down` command):

```bash
# What is applied / pending / drifted?
node scripts/migrate.mjs status

# Apply everything pending (advisory-locked; safe with replicas)
node scripts/migrate.mjs up
```

In Coolify, set the **Post-deployment Command** to `node scripts/migrate.mjs up`
— it runs once in the **newly deployed** container after it starts. Do NOT use
the Pre-deployment Command for this: Coolify executes pre-deployment commands
inside the currently *running* (old) container, which can never see a migration
or runner change that first ships in the release being deployed (this failed
with `MODULE_NOT_FOUND` on the first hardened deploy). The brief window where
new code runs before its migrations apply is safe because migrations here are
additive and idempotent (CI-enforced); for a release whose code hard-requires a
migration, run `up` manually against the database before deploying. The runner
connects via `MIGRATION_DATABASE_URL` (falling back to `DATABASE_URL`, then
`MYSQL_*`), so the migrating identity can hold DDL privileges while the app's
runtime user stays DML-only.

**One-time bootstrap per existing database** (prod, local dev): record the
already-applied history as a baseline, after taking a fresh backup:

```bash
node scripts/migrate.mjs baseline --through 025 --yes
```

The baseline probes a sentinel (`tickets.contact_id`, added by 025) and
refuses to run against a database that is not actually at 025.
Migration 025 must run **after** 024 (`tickets.contact_id` references `contacts.id`). It also
widens `tickets.fid`/`tickets.oid` from `VARCHAR(4)`/`VARCHAR(2)` to `VARCHAR(120)` and makes both
nullable. **Audit for already-truncated values before running it:**
```sql
SELECT id, fid, oid FROM tickets WHERE CHAR_LENGTH(oid) = 2 OR CHAR_LENGTH(fid) = 4;
```
A 2-character `oid` is a real outlet id truncated by the old column width and cannot be recovered
from the ticket row alone — reconcile it against `merchant_outlets` first.

Track which migrations have been applied per environment — most are plain `ALTER TABLE` statements and will error (harmlessly) if re-run against an already-migrated schema. The Project Tracker migrations (020–023) are `CREATE TABLE IF NOT EXISTS` and are safe to re-run, but **must** be applied in order: 021 depends on 020, and 022/023 depend on the composite unique key created in 021.

**Signedness is now reconciled.** `schema.sql` previously declared every id as
`BIGINT UNSIGNED` while the deployed database had drifted to signed, so the
numbered migrations used signed `BIGINT` to match production and the two
disagreed. A production survey on 2026-08-29
(`audit/evidence/prod-bigint-signedness-2026-08-29.json`) established the real
picture: **57 of 70 id columns are signed in production, and 13 are genuinely
unsigned** — the older tables (`merchants`, `merchant_outlets`, `sessions.id`,
`auth_tokens.id`, `ticket_categories`, `sales_appointments.id`,
`onboarding_appointments.id`) kept unsigned ids, while every `*_user_id` column
became signed to match `users.id`. `schema.sql` now matches column for column,
so a fresh import and production have the same shape. MySQL still requires
foreign-key columns to match the referenced column's signedness exactly — see
the header note in `migrations/011_leads_assignment_deals_activities.sql`.

CI runs the migration job against **two** shapes: `fresh` loads `schema.sql`,
and `production` loads `migrations/fixtures/prod-shape-025.sql`. Before this,
CI loaded only `schema.sql` and so exercised a database that existed nowhere.
The fixture is deliberately editable (it is excluded from the append-only guard)
because it must track production as production changes.
