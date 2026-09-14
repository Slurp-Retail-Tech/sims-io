/**
 * Job type identifiers, deliberately in a module with no imports.
 *
 * They live here rather than beside their handlers so that lightweight
 * consumers — the artifact reaper, routes, tests — can name a job type without
 * pulling in the handler's whole dependency tree. `plus-import.ts` in
 * particular uses `@/` path aliases, which do not resolve under `node --test`,
 * so importing it transitively would make a module untestable.
 */
export const PLUS_IMPORT_JOB_TYPE = "plus-import"
export const MERCHANT_IMPORT_JOB_TYPE = "merchant-import"
export const CLICKUP_SYNC_JOB_TYPE = "clickup-sync"
