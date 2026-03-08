This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

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

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `src/app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load Geist.

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
RESEND_API_KEY=

MINIO_ENDPOINT=http://127.0.0.1:9000
MINIO_PUBLIC_URL=http://127.0.0.1:9000
MINIO_ACCESS_KEY=minioadmin
MINIO_SECRET_KEY=minioadmin
MINIO_BUCKET=sims-assets
MINIO_REGION=us-east-1

NEXT_PUBLIC_SUPPORT_PHONE=
NEXT_PUBLIC_SUPPORT_EMAIL=
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
- `NEXT_PUBLIC_SUPPORT_WHATSAPP` and `NEXT_PUBLIC_SUPPORT_CONTACT` are legacy fallbacks.
- reCAPTCHA enforcement is enabled when `RECAPTCHA_SECRET_KEY` is set on the server.
- Demo form lead submissions sync to HubSpot when `HUBSPOT_ACCESS_TOKEN` is configured.
- Demo form lead email notifications send through Resend when `RESEND_API_KEY` is configured and the lead notification setting is enabled.
- `RESEND_BASE_URL` is not used by the current implementation.
- `HUBSPOT_BUSINESS_TYPE_PROPERTY`, `HUBSPOT_BUSINESS_LOCATION_PROPERTY`, and `HUBSPOT_SOURCE_PROPERTY` map form fields to your HubSpot custom contact property names.

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
See `docs/scheduler.md` for a ready-to-use setup, including curl examples,
cron timing in Asia/Kuala_Lumpur, and the `MERCHANT_IMPORT_USER_ID` secret.

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

## File Uploads (MinIO)

All file uploads should go through the shared API: `POST /api/uploads`.
See `docs/uploads.md` for request format and folder conventions.

This project relies on `schema.sql` for database updates. If you already have data in MySQL, back it up before reloading the schema.

## Knowledge Base Operations

The KB workflow is Notion-first and publishes approved content manually into the in-app Knowledge Base.

- Program runbook: `docs/knowledge-base-program.md`
- In-app KB contract: `src/lib/knowledge-base.ts`
- In-app KB page: `src/app/(app)/knowledge-base/page.tsx`

## Deployment

Use the platform or container runtime that matches your infrastructure.

For Coolify (Dockerfile build):
- Set the build context to repo root.
- Use `Dockerfile` at the repo root.
