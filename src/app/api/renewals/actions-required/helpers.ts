/**
 * Access keys for the Actions Required routes.
 *
 * Separate module for the same reason as the invoice helpers: a Next.js
 * `route.ts` may export only route handlers and a fixed set of config values.
 */

/** Reading the queue. */
export const ACTIONS_VIEW_PATH = "/renewal-retention/actions-required"
/** Dismissing an entry. */
export const ACTIONS_MANAGE_PATH = "/renewal-retention/actions-required/manage"
