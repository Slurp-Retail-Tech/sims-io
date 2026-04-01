# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Project Is

SIMS is an internal merchant engagement platform built with Next.js App Router. It manages support tickets, sales leads, merchant directories, renewal tracking, and appointment scheduling — with integrations to ClickUp, a POS API, Google Workspace, MinIO, and HubSpot.

## Commands

```bash
# Development
npm install
npm run dev          # Starts Next.js dev server on port 3000 (uses Webpack, not Turbopack)
npm run build
npm run lint         # ESLint with Next.js config

# Local services (MySQL:3307, phpMyAdmin:8081, MinIO:9002/9003)
docker compose up -d
npm run db:import:platform-data  # Import platform data from SQL dump
```

No automated test suite exists yet. Use the `test-writer` agent when adding tests. For linting only `npm run lint` is available.

## Architecture

### Route Organization

```
src/app/
├── (app)/          # Protected routes — require sims-auth cookie
│   ├── dashboard/, tickets/, merchants/, leads/, sales/
│   ├── renewal-retention/   # Preview-only; not live analytics
│   ├── analytics/, overview/, inbox/, knowledge-base/
│   └── user-management/, preferences/, profile/
├── api/            # Route handlers (thin — delegate to src/lib/)
├── login/, activate/, reset-password/
└── supportform/, demoform/, csat/   # Public-facing forms
```

**Middleware** (`middleware.ts`) guards the `(app)/` routes by checking the `sims-auth` cookie and redirecting to `/login`. Middleware does not cover API routes — each route self-validates.

### Key Directories

| Path | Purpose |
|---|---|
| `src/lib/` | Shared server-side business logic and integrations |
| `src/components/` | React components; UI primitives under `src/components/ui/` |
| `src/hooks/` | React hooks |
| `schema.sql` | Authoritative MySQL schema (snake_case tables/columns) |
| `docs/` | PRD, TDD, style guide, operational docs |
| `scripts/` | Database and import scripts |
| `security-audit/` | Security audit reports — one file per run |

### Data Flow

All API routes live at `src/app/api/**/route.ts` and must stay thin — move business logic into `src/lib/`. Database access goes through the pool in `src/lib/db.ts` (supports `DATABASE_URL` or individual `MYSQL_*` env vars). File storage uses MinIO via the AWS S3 SDK (`src/lib/storage.ts`).

### Authentication

Session cookies store an opaque random token (not the user ID). The flow:

1. **Login / Google SSO** → `createSession(userId, remember)` inserts a hashed token into the `sessions` table and returns the raw token → stored in the `sims-auth` httpOnly cookie.
2. **Per-request validation** → `requireAuthenticatedUser(request)` reads the cookie, SHA-256 hashes it, JOINs `sessions` + `users`, checks `expires_at`, and returns the user or `null`.
3. **Logout** → `clearAuthCookie(response, sessionToken)` deletes the session row and clears the cookie.
4. **Password reset** → invalidates all existing sessions for the user via `DELETE FROM sessions WHERE user_id = ?`.

All protected API routes call `requireAuthenticatedUser(request)` from `src/lib/auth.ts`. Public API endpoints (no auth required): `/api/auth/*`, `/api/supportform/*`, `/api/csat/*`, and `POST /api/leads`.

Cookie flags: `httpOnly`, `SameSite=strict`, `Secure` when `NODE_ENV=production` or `APP_BASE_URL` starts with `https://`. TTL: 7 days default, 30 days with "remember me".

Passwords: scrypt with a 16-byte random salt, 64-byte hash. Minimum length: 12 characters.

### Rate Limiting

`src/lib/rate-limit.ts` + `src/lib/rate-limit-store.ts` provide per-IP rate limiting:

- **Redis** (`REDIS_URL`) when configured — required in production.
- **In-memory fallback** when `REDIS_URL` is absent — development only; limits are per-process.
- IP extraction: reads `x-forwarded-for` only when `TRUSTED_PROXY` env var is set; otherwise falls back to `"direct"` to prevent header spoofing.

Applied limits: login (10/15 min), forgot-password (5/15 min), support form (5/min), leads form (3/min).

### External Integrations

| Integration | Env prefix | Lib file |
|---|---|---|
| ClickUp (task sync) | `CLICKUP_*` | `src/lib/clickup.ts`, `clickup-ticket-sync.ts` |
| POS API (merchant import) | `POS_*` | `src/lib/pos-api.ts`, `merchant-import.ts` |
| Google OAuth | `GOOGLE_*` | `src/lib/auth.ts` |
| HubSpot (leads) | `HUBSPOT_*` | `src/lib/lead-notification.ts` |
| Email (Google SMTP) | `SMTP_*` | `src/lib/mail.ts`, `auth-email.ts` |
| MinIO/S3 | `MINIO_*` | `src/lib/storage.ts` |
| Mapbox | `NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN` | `src/lib/outlet-map.ts` |
| Redis (rate limiting) | `REDIS_URL` | `src/lib/rate-limit-store.ts` |

## Conventions

- **Filenames**: kebab-case (`ticket-history.ts`)
- **Classes**: PascalCase; **variables/functions**: camelCase
- **Database**: snake_case (matches `schema.sql`)
- **No `any`**: use narrowed unions or small interfaces
- **Exported functions in `src/lib/`**: explicit return types
- Reuse `src/components/ui/` primitives before adding new ones
- Keep loading, empty, and error states explicit in async UI
- API routes return generic error messages to clients; log full details server-side

## Schema Notes

`schema.sql` is the single source of truth. Notable tables:

- `sessions` — server-side session store; rows expire and are deleted on logout/password reset
- `auth_tokens` — activation and password-reset tokens stored as SHA-256 hashes (`token_hash`)
- `csat_tokens` — CSAT survey tokens stored as SHA-256 hashes (`token_hash`); raw token sent only in the survey URL

## Documentation Alignment

When changing behavior, architecture, or env variables, update the relevant doc in the same task:
- Product intent → `docs/PRD.md`
- Technical design / data models → `docs/TDD.md`
- Env vars / setup → `README.md`

The **Renewal & Retention overview** is preview-only (sample data). Do not describe it as live analytics.

## Commit Style

Imperative summaries with scope: `fix: handle null outlet in ticket lookup`, `api: add idempotency to ClickUp sync`. Include migrations, new env vars, and rollout notes in PR descriptions.
