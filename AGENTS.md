# Repository Guidelines

This repository contains planning documents for the Unified Engagement Platform and an active Next.js app at the repo root. Keep `AGENTS.md`, `PRD.md`, `TDD.md`, and `CODEX_STYLE_GUIDE.md` aligned with implementation decisions, especially when current implementation differs from the target-state design.

## Project Structure and Module Organization
- Current docs: `docs/PRD.md` (product requirements), `docs/TDD.md` (technical design), and `docs/CODEX_STYLE_GUIDE.md` (Codex contribution style guide).
- Target-state layout from `docs/TDD.md`: `api/`, `worker/`, `packages/shared/`, and the web UI at repo root.
- Current layout includes the Next.js UI at repo root, with app code under `src/`, static assets under `public/`, SQL schema in `schema.sql`, and operational scripts under `scripts/`.
- Current API handlers live in `src/app/api/`, and shared business logic lives in `src/lib/`.
- Editor settings live in `.vscode/` for workspace linting configuration.
- Infrastructure and deployment artifacts should live under `deploy/`, and database migrations under `migrations/`.
- Add new top-level directories sparingly and document them here.

## Build, Test, and Development Commands
- Web UI (local):
  - `npm install`
  - `npm run dev`
  - `npm run build`
  - `npm run start`
  - `npm test`
  - `npm run lint`
- Local data and storage services:
  - `docker compose up -d`
  - `npm run db:import:platform-data`
- Current `docker-compose.yml` provisions MySQL on `localhost:3307`, phpMyAdmin on `localhost:8081`, MinIO API on `localhost:9002`, and MinIO console on `localhost:9003`.
- Import helpers live under `scripts/`; prefer the existing npm script for platform data imports before adding one-off commands.

## Coding Style and Naming Conventions
- Match the existing docs style: short paragraphs, explicit headings, and concise lists.
- For TypeScript and NestJS, use kebab-case filenames (for example, `ticket.service.ts`), PascalCase classes, and camelCase variables.
- Use snake_case for database tables and columns, as shown in `TDD.md` (for example, `contact_outlet`, `expiry_date`).
- Add formatter and linter configs with the first code drop and keep them in the repo root (for example, ESLint and Prettier).

## Testing Guidelines
- Current automated coverage uses Node's built-in test runner for focused TypeScript helper tests via `npm test`.
- Name unit tests `*.spec.ts` and end-to-end tests `*.e2e-spec.ts` if using NestJS defaults.
- Cover critical flows: webhook signature verification, POS sync, renewal scheduling, and CSAT capture.

## Commit and Pull Request Guidelines
- Git history currently contains only "first commit", so there is no established convention.
- Use concise, imperative commit summaries and include a scope when helpful (for example, `api: verify webhook signature`).
- Pull requests should include a summary, link to the relevant PRD or TDD section, and screenshots for UI changes.
- Call out migrations, new environment variables, and rollout notes in the PR description.

## Security and Configuration
- Never commit secrets. Use `.env` and follow the variable names in `TDD.md` (for example, `POS_*`, `DATABASE_URL`).
- Follow PDPA constraints: minimize PII, document retention, and include erasure or audit considerations with data model changes.
- When documenting dashboards, distinguish clearly between live metrics and preview-only UI. The Renewal & Retention overview is currently preview-only and should not be described as production analytics.
