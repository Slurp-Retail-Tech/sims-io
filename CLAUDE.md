# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Project Is

SIMS is an internal merchant engagement platform built with Next.js App Router. It manages support tickets, sales leads, merchant directories, renewal tracking, and appointment scheduling — with integrations to ClickUp, a POS API, Google Workspace, and MinIO.

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

There is currently no automated test suite. For linting only `npm run lint` is available.

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

**Middleware** (`middleware.ts`) guards the `(app)/` routes by checking the `sims-auth` cookie and redirecting to `/login`.

### Key Directories

| Path | Purpose |
|---|---|
| `src/lib/` | Shared server-side business logic and integrations |
| `src/components/` | React components; UI primitives under `src/components/ui/` |
| `src/hooks/` | React hooks |
| `schema.sql` | Authoritative MySQL schema (snake_case tables/columns) |
| `docs/` | PRD, TDD, style guide, operational docs |
| `scripts/` | Database and import scripts |

### Data Flow

All API routes live at `src/app/api/**/route.ts` and must stay thin — move business logic into `src/lib/`. Database access goes through the pool in `src/lib/db.ts` (supports `DATABASE_URL` or individual `MYSQL_*` env vars). File storage uses MinIO via the AWS S3 SDK (`src/lib/storage.ts`).

### Authentication

- Session stored in `sims-auth` cookie (httpOnly, secure in production, 7-day TTL / 30-day with "remember me")
- Passwords hashed with scrypt (salt + 64-byte hash) — see `src/lib/auth.ts`
- Google Workspace SSO with domain allowlist via `GOOGLE_WORKSPACE_DOMAINS`

### External Integrations

| Integration | Env prefix | Lib file |
|---|---|---|
| ClickUp (task sync) | `CLICKUP_*` | `src/lib/clickup.ts`, `clickup-ticket-sync.ts` |
| POS API (merchant import) | `POS_*` | `src/lib/pos-api.ts`, `merchant-import.ts` |
| Google OAuth | `GOOGLE_*` | `src/lib/auth.ts` |
| Email (Google SMTP) | `SMTP_*` | `src/lib/mail.ts`, `auth-email.ts` |
| MinIO/S3 | `MINIO_*` | `src/lib/storage.ts` |
| Mapbox | `NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN` | `src/lib/outlet-map.ts` |

## Conventions

- **Filenames**: kebab-case (`ticket-history.ts`)
- **Classes**: PascalCase; **variables/functions**: camelCase
- **Database**: snake_case (matches `schema.sql`)
- **No `any`**: use narrowed unions or small interfaces
- **Exported functions in `src/lib/`**: explicit return types
- Reuse `src/components/ui/` primitives before adding new ones
- Keep loading, empty, and error states explicit in async UI

## Documentation Alignment

When changing behavior, architecture, or env variables, update the relevant doc in the same task:
- Product intent → `docs/PRD.md`
- Technical design / data models → `docs/TDD.md`
- Env vars / setup → `README.md` **and** `.env.example`

Every new or removed env var must be reflected in `.env.example`. Leave values blank or as a safe placeholder — never commit real secrets.

The **Renewal & Retention overview** is preview-only (sample data). Do not describe it as live analytics.

## Commit Style

Imperative summaries with scope: `fix: handle null outlet in ticket lookup`, `api: add idempotency to ClickUp sync`. Include migrations, new env vars, and rollout notes in PR descriptions.

## Rules

### Versioning

Bump `package.json` version **before** every commit that ships code. Follow semver strictly:

| Change type | Version segment |
|---|---|
| Breaking change (schema, API contract, auth flow) | Major |
| New user-facing feature | Minor |
| Bug fix, refactor, chore, dependency update | Patch |
| Documentation only (no code change) | No bump |

### Release Notes

Every version bump must have a corresponding markdown file at `src/app/(app)/release-notes/content/<version>.md`. Create it in the same commit as the bump. Use the frontmatter schema already established in that directory (version, date, title, summary, new, improved, fixed, breaking_changes). Do not include upgrade_notes in the page — the field is unused by the renderer.

### New Pages — Access Control Sync

Whenever a new route is added under `src/app/(app)/`:

1. **`src/lib/page-access.ts`** — add a mapping to `accessRouteMappings` so `getAccessKeysForPath` resolves the route to the correct access key(s). If the page is informational and should be accessible to all authenticated users (no role restriction), add it to `UNIVERSAL_ACCESS_PREFIXES` instead.
2. **`src/app/(app)/user-management/page.tsx`** — add the page to the correct department group in `pageAccessGroups` with a label and access key value. Skip this step for universal-access pages.

Omitting either update makes the page invisible in the sidebar and inaccessible to non-Super Admin users.

### Page Titles

Every page must have a dedicated browser title — never rely on the root layout's default `"SIMS"`.

- **Server component pages**: export `metadata` directly from the `page.tsx`.
- **Client component pages** (`"use client"`): create a sibling `layout.tsx` that exports `metadata` and returns `children` unchanged (see `src/app/(app)/maps/layout.tsx` as the pattern).
- **Dynamic routes**: export `generateMetadata` from the `page.tsx` and derive the title from the route params (e.g. `v${release.version} · ${release.title}`).
- Use concise, descriptive names. Prefer `"Merchant Success – Tickets"` over `"Merchant Success Tickets Page"`.

### UI State Persistence

Use cookies for UI filter and selector state that should survive page refreshes:

- Cookie names follow the pattern `<context>_<thing>` (e.g. `sidebar_workspace`, `tickets_date_filter`, `merchant_success_analytics_filter`).
- Set `Max-Age` appropriate to the context: 12 hours for volatile filters, 30 days for UI preferences.
- Always set `Path=/` so the cookie is available across all routes.
- Read cookies client-side via `document.cookie` in a lazy `useState` initialiser (not `useEffect`) so the value is available on first render without a flash.
- Do not use `localStorage` for UI state — reserve it for the session user cache (`sims-session`) only.

### Security Audit Reports

Save audit reports to `/audit/` at the project root. Each run gets its own file — never append to an existing report. Use a datestamped filename: `audit-YYYY-MM-DD.md`.
