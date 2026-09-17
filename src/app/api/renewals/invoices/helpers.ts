/**
 * Access keys for the invoice routes.
 *
 * In their own module because a Next.js `route.ts` may export only route
 * handlers and a fixed set of config values; exporting a constant from one
 * fails the build's generated route types.
 */

/** Reading the list or one invoice. */
export const INVOICES_VIEW_PATH = "/renewal-retention/invoices"
/** Manual actions on an invoice: void, mark paid offline, resend, re-price. */
export const INVOICES_MANAGE_PATH = "/renewal-retention/invoices/manage"
