# Repository Guidelines

This repository currently contains planning documents for the Unified Engagement Platform. Keep `AGENTS.md`, `PRD.md`, `TDD.md`, and `CODEX_STYLE_GUIDE.md` aligned with implementation decisions.

## Project Structure and Module Organization
- Current files: `docs/PRD.md` (product requirements), `docs/TDD.md` (technical design), and `docs/CODEX_STYLE_GUIDE.md` (Codex contribution style guide).
- Planned layout from `docs/TDD.md`: `api/`, `worker/`, `packages/shared/`, and the web UI at repo root.
- Current layout includes the Next.js UI at repo root.
- Editor settings live in `.vscode/` for workspace linting configuration.
- Infrastructure and deployment artifacts should live under `deploy/`, and database migrations under `migrations/`.
- Add new top-level directories sparingly and document them here.

## Build, Test, and Development Commands
- Web UI (local):
  - `npm install`
  - `npm run dev`
- If following `TDD.md`, expect a local stack via `docker compose up` for MySQL, Redis, RabbitMQ, and MinIO.
- Document app run scripts (for example, `npm run dev` or `npm run start:worker`) in the README when they exist.

## Coding Style and Naming Conventions
- Match the existing docs style: short paragraphs, explicit headings, and concise lists.
- For TypeScript and NestJS, use kebab-case filenames (for example, `ticket.service.ts`), PascalCase classes, and camelCase variables.
- Use snake_case for database tables and columns, as shown in `TDD.md` (for example, `contact_outlet`, `expiry_date`).
- Add formatter and linter configs with the first code drop and keep them in the repo root (for example, ESLint and Prettier).

## Testing Guidelines
- Testing framework is not selected; use framework defaults once code is added (NestJS commonly uses Jest).
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
