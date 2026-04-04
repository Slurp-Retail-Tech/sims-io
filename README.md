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
- Nodemailer for email delivery
- Mapbox GL for map views

## Current Product Areas

- Merchant Success — tickets, ticket history, SLA breaches, CSAT insights, audit trail, ticket categories, ClickUp task sync, onboarding appointments and schedule, analytics
- Merchant directory, POS import, and PLUS merchant workflows
- Sales — leads, appointments, overview, and analytics
- Renewal & Retention — renewal due tracking and analytics overview
- User management, activation, reset-password, and Google Workspace SSO
- Public support and demo forms
- Merchant map and knowledge base
- Release notes

## Current Known Gaps

- Some dashboards are still UI previews or placeholder analytics.
- Renewal & Retention overview currently shows sample data only and is not live reporting.
- External messaging-channel integration from the PRD/TDD is not implemented in this app.
- Automated tests have not been added yet.

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
MERCHANT_IMPORT_USER_ID=

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

# ── HubSpot ───────────────────────────────────────────────────────────────────
HUBSPOT_ACCESS_TOKEN=
HUBSPOT_BUSINESS_TYPE_PROPERTY=
HUBSPOT_BUSINESS_LOCATION_PROPERTY=
HUBSPOT_SOURCE_PROPERTY=

# ── Public forms ──────────────────────────────────────────────────────────────
NEXT_PUBLIC_SUPPORT_PHONE=
NEXT_PUBLIC_SUPPORT_EMAIL=
SUPPORTFORM_WHATSAPP_NUMBER=
DEMOFORM_WHATSAPP_NUMBER=

# ── reCAPTCHA (demo form bot protection) ─────────────────────────────────────
# Required in production — verification fails closed if secret is missing.
NEXT_PUBLIC_RECAPTCHA_SITE_KEY=
RECAPTCHA_SECRET_KEY=

# ── Mapbox ────────────────────────────────────────────────────────────────────
# Required for the /maps page. Baked into the client bundle at build time.
NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN=
```

Notes:
- `REDIS_URL` — required in production; in development, rate limiting falls back to an in-memory store
- `TRUSTED_PROXY=true` — set when running behind Coolify/Traefik; enables `X-Forwarded-For` reading for rate-limit IP derivation
- `MINIO_PUBLIC_URL` — set to the public-facing URL for MinIO when it differs from the internal `MINIO_ENDPOINT` (always the case in production behind a reverse proxy)
- MinIO object expiry — apply a 60-day lifecycle rule on the `uploads/` prefix after provisioning (avatars are exempt); see `docs/TDD.md` for the `mc ilm add` command
- `DATABASE_URL` takes precedence over individual `MYSQL_*` vars if both are set
- `APP_BASE_URL` — used in activation emails, password reset emails, and Google OAuth callbacks; must match the registered OAuth redirect URI exactly
- `GOOGLE_WORKSPACE_DOMAINS` — comma-separated allowlist of Google Workspace domains permitted for SSO login
- `NEXT_PUBLIC_RECAPTCHA_SITE_KEY` and `NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN` are baked into the JS bundle at build time; changing them requires a full redeploy, not just a container restart
- `RECAPTCHA_SECRET_KEY` — reCAPTCHA enforcement is fail-closed in production; the demo form POST returns 500 if this is missing

## Google Workspace SMTP Setup

1. Create or choose a dedicated Google Workspace mailbox for SIMS outbound email.
2. Enable 2-Step Verification on that mailbox.
3. Generate an App Password for mail delivery and set it as `SMTP_PASS`.
4. Set `SMTP_USER` to the mailbox address and `SMTP_FROM_EMAIL` to the same mailbox or an allowed alias.
5. Optionally set `SMTP_FROM_NAME` for the display name shown in auth and lead notification emails.

After deployment, verify:
- resend activation email from the user management page
- forgot-password flow
- demo form lead notification delivery

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
`MERCHANT_IMPORT_USER_ID` value from `users.id`.

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

**Database migrations** must be run manually before deploying schema changes:
```bash
mysql -u user -p dbname < migrations/001_security_remediation.sql
```
Migration scripts are in `migrations/` and are idempotent — safe to run twice.
