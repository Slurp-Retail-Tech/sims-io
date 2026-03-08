# Codex Style Guide

This guide defines how Codex should make changes in this repository. Use it together with `AGENTS.md`, `docs/PRD.md`, and `docs/TDD.md`.

## Objectives
- Keep changes small, reviewable, and aligned with product and technical docs.
- Prefer predictable patterns over clever abstractions.
- Preserve current behavior unless the task explicitly requires a behavior change.

## First Checks Before Editing
1. Read `AGENTS.md` for repository rules.
2. Read relevant sections in `docs/PRD.md` and `docs/TDD.md` for feature intent.
3. Inspect existing code in the same folder and follow its patterns.
4. Confirm required environment variables for the touched flow in `README.md`.

## Repository Conventions
- App framework: Next.js App Router at `src/app/`.
- API endpoints: `src/app/api/**/route.ts`.
- Shared server logic: `src/lib/`.
- UI components: `src/components/` and `src/components/ui/`.
- Documentation updates belong in `docs/`.

## TypeScript and React Standards
- Use TypeScript for all new code.
- Keep filenames in kebab-case.
- Use PascalCase for React components and camelCase for variables/functions.
- Prefer explicit return types for exported functions in `src/lib/` and API helpers.
- Avoid `any`; use narrowed unions or small interfaces.
- Keep components focused; extract reusable logic to `src/lib/` or dedicated hooks.

## API Route Standards
- Validate inputs early and return clear HTTP status codes.
- Keep route handlers thin; move business logic to `src/lib/`.
- Use consistent JSON response shapes for success and error paths.
- Guard secret-bearing operations with environment checks.
- Add idempotency and duplicate protection where webhook/sync behavior is involved.

## Database and Data Handling
- Keep database naming in snake_case to match `schema.sql` and `docs/TDD.md`.
- Prefer small, explicit SQL changes over broad refactors.
- Minimize PII storage and handling; follow PDPA constraints from `AGENTS.md`.
- Document schema or data model changes in `docs/TDD.md` and rollout notes.

## UI and UX Standards
- Reuse existing UI primitives from `src/components/ui/` before adding new ones.
- Maintain responsive behavior for desktop and mobile.
- Keep loading, empty, and error states explicit for async UI.
- Preserve existing navigation and layout structure unless the task asks otherwise.

## Testing and Verification
- Run targeted checks before finalizing:
  - `npm run lint`
  - Relevant manual flow for changed routes/pages
- Add or update tests when a test harness exists for the changed area.
- For high-risk changes, include a short validation checklist in the PR or handoff notes.

## Documentation and Handoff Rules
- If behavior, architecture, or operations change, update docs in the same task:
  - Product intent: `docs/PRD.md`
  - Technical design: `docs/TDD.md`
  - Run/setup/env: `README.md`
- Mention new environment variables, migrations, and rollout considerations.

## Change Quality Checklist
- Scope is minimal and task-focused.
- Naming is consistent with local patterns.
- Errors are handled and surfaced clearly.
- No secrets are hardcoded.
- Docs are updated when needed.
