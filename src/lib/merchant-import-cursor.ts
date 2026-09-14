/**
 * Resume cursor for the paginated POS merchant import.
 *
 * Pure and runtime-free so it can be unit-tested under `node --test`.
 */
export type MerchantImportCursor = {
  /** Next POS page to fetch, 1-based. */
  page: number
  /** Records imported so far, carried across slices for reporting. */
  imported: number
}

export const INITIAL_MERCHANT_IMPORT_CURSOR: MerchantImportCursor = {
  page: 1,
  imported: 0,
}

export function parseMerchantImportCursor(
  value: unknown
): MerchantImportCursor {
  if (value && typeof value === "object") {
    const raw = value as { page?: unknown; imported?: unknown }
    const page = Number(raw.page)
    const imported = Number(raw.imported)
    if (Number.isInteger(page) && page >= 1) {
      return {
        page,
        imported: Number.isFinite(imported) && imported >= 0 ? imported : 0,
      }
    }
  }
  return INITIAL_MERCHANT_IMPORT_CURSOR
}

export type AdvanceReason = "short-page" | "empty" | "max-pages" | null

/**
 * Decide whether the import continues after a page.
 *
 * `maxPages` is a guard the previous loop lacked: it ran `while (hasMore)` with
 * no ceiling, so a POS endpoint that kept returning full pages would loop until
 * the request died. Hitting the cap ends the run and says so, rather than
 * pretending the import finished.
 */
export function advancePageCursor(
  cursor: MerchantImportCursor,
  itemsReturned: number,
  perPage: number,
  maxPages: number
): { cursor: MerchantImportCursor; done: boolean; reason: AdvanceReason } {
  const next: MerchantImportCursor = {
    page: cursor.page + 1,
    imported: cursor.imported + itemsReturned,
  }

  if (itemsReturned === 0) {
    return { cursor: next, done: true, reason: "empty" }
  }
  if (itemsReturned < perPage) {
    return { cursor: next, done: true, reason: "short-page" }
  }
  if (next.page > maxPages) {
    return { cursor: next, done: true, reason: "max-pages" }
  }
  return { cursor: next, done: false, reason: null }
}
