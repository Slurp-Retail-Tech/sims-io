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
- MinIO via AWS S3 SDK
- ClickUp API integration
- POS API integration
- Nodemailer for email delivery
- Mapbox GL for map views

## Current Product Areas

- Merchant Success tickets, ticket history, and ClickUp task sync
- Merchant directory, POS import, and PLUS merchant workflows
- Sales leads and appointments
- Onboarding appointments
- User management, activation, reset-password, and Google auth
- Public support and demo forms
- Merchant map and knowledge base

## Current Known Gaps

- Some dashboards are still UI previews or placeholder analytics.
- Renewal & Retention overview currently shows sample data only and is not live reporting.
- External messaging-channel integration from the PRD/TDD is not implemented in this app.
- Automated tests have not been added yet.

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to access the app.

## Environment Variables

Create `.env.local` at the repo root.

```
DATABASE_URL=

MYSQL_HOST=127.0.0.1
MYSQL_PORT=3306
MYSQL_USER=sims
MYSQL_PASSWORD=sims-password
MYSQL_DATABASE=sims-local

POS_API_EMAIL=email@example.com
POS_API_PASSWORD=password
POS_AUTH_URL=https://api.getslurp.com/api/login
POS_IMPORT_URL=http://api.getslurp.com/api/franchise-retrieve/

MERCHANT_IMPORT_USER_ID=
CLICKUP_SYNC_CRON_SECRET=

CLICKUP_API_TOKEN=
CLICKUP_LIST_ID=
CLICKUP_API_BASE_URL=https://api.clickup.com/api/v2
NEXT_PUBLIC_CLICKUP_ENABLED=true
HUBSPOT_ACCESS_TOKEN=
HUBSPOT_BUSINESS_TYPE_PROPERTY=
HUBSPOT_BUSINESS_LOCATION_PROPERTY=
HUBSPOT_SOURCE_PROPERTY=
SMTP_HOST=smtp.gmail.com
SMTP_PORT=465
SMTP_SECURE=true
SMTP_USER=
SMTP_PASS=
SMTP_FROM_EMAIL=noreply@getslurp.com
SMTP_FROM_NAME=SIMS
APP_BASE_URL=http://localhost:3000
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_REDIRECT_URI=
GOOGLE_WORKSPACE_DOMAINS=getslurp.com

MINIO_ENDPOINT=http://127.0.0.1:9000
MINIO_PUBLIC_URL=http://127.0.0.1:9000
MINIO_ACCESS_KEY=minioadmin
MINIO_SECRET_KEY=minioadmin
MINIO_BUCKET=sims-assets
MINIO_REGION=us-east-1

NEXT_PUBLIC_SUPPORT_PHONE=
NEXT_PUBLIC_SUPPORT_EMAIL=
NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN=
SUPPORTFORM_WHATSAPP_NUMBER=601156654761
DEMOFORM_WHATSAPP_NUMBER=601156654761
# Legacy fallback only
NEXT_PUBLIC_SUPPORT_WHATSAPP=601156654761

# Optional but recommended for /demoform bot protection
NEXT_PUBLIC_RECAPTCHA_SITE_KEY=
RECAPTCHA_SECRET_KEY=
```

Notes:
- `SUPPORTFORM_WHATSAPP_NUMBER` is used for `/supportform` redirect.
- `DEMOFORM_WHATSAPP_NUMBER` is used for `/demoform` redirect.
- `NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN` is required for the General `/maps` page.
- `NEXT_PUBLIC_SUPPORT_WHATSAPP` and `NEXT_PUBLIC_SUPPORT_CONTACT` are legacy fallbacks.
- reCAPTCHA enforcement is enabled when `RECAPTCHA_SECRET_KEY` is set on the server.
- Demo form lead submissions sync to HubSpot when `HUBSPOT_ACCESS_TOKEN` is configured.
- Demo form lead email notifications and auth emails send through Google Workspace SMTP when `SMTP_USER`, `SMTP_PASS`, and `SMTP_FROM_EMAIL` are configured.
- All outbound emails use the configured SMTP sender identity; the lead notification page only manages recipients and enable/disable status.
- `APP_BASE_URL` should point to the public app URL used in activation, reset-password, and Google OAuth callbacks.
- `GOOGLE_WORKSPACE_DOMAINS` is a comma-separated allowlist of Google Workspace domains for SSO.
- `HUBSPOT_BUSINESS_TYPE_PROPERTY`, `HUBSPOT_BUSINESS_LOCATION_PROPERTY`, and `HUBSPOT_SOURCE_PROPERTY` map form fields to your HubSpot custom contact property names.

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
- MySQL runs on `localhost:3306` with database `sims-local` and user `sims`/`sims-password`.
- phpMyAdmin is at `http://localhost:8080` (server: `mysql`, user: `sims`, password: `sims-password`).
- MinIO is at `http://localhost:9000` with console at `http://localhost:9001`.

The schema file at `schema.sql` is loaded automatically the first time the container starts. If you need to re-run it, delete the `mysql_data` volume and restart.

Default login (local):
- Email: `admin@getslurp.com`
- Password: `sims-admin`

### Import data from `sims-platform (1).sql`

Import data-only records (INSERT statements) from the phpMyAdmin dump into the
current Docker MySQL (`sims-local`):

```bash
npm run db:import:platform-data
```

To import a different file path:

```bash
npm run db:import:platform-data -- "/absolute/path/to/file.sql"
```

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

## Deployment

Use the platform or container runtime that matches your infrastructure.

For Coolify (Dockerfile build):
- Set the build context to repo root.
- Use `Dockerfile` at the repo root.
