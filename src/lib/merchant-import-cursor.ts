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
  /**
   * Merchants rejected, and merchants written with outlets skipped. Carried in
   * the cursor because a slice is not handed the previous progress, and the
   * run's final status is decided from the totals across every slice.
   */
  failed: number
  partial: number
}

export const INITIAL_MERCHANT_IMPORT_CURSOR: MerchantImportCursor = {
  page: 1,
  imported: 0,
  failed: 0,
  partial: 0,
}

function readCount(value: unknown): number {
  const count = Number(value)
  return Number.isFinite(count) && count >= 0 ? count : 0
}

export function parseMerchantImportCursor(
  value: unknown
): MerchantImportCursor {
  if (value && typeof value === "object") {
    const raw = value as {
      page?: unknown
      imported?: unknown
      failed?: unknown
      partial?: unknown
    }
    const page = Number(raw.page)
    if (Number.isInteger(page) && page >= 1) {
      return {
        page,
        imported: readCount(raw.imported),
        failed: readCount(raw.failed),
        partial: readCount(raw.partial),
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
  maxPages: number,
  outcomes: { failed: number; partial: number } = { failed: 0, partial: 0 }
): { cursor: MerchantImportCursor; done: boolean; reason: AdvanceReason } {
  const next: MerchantImportCursor = {
    page: cursor.page + 1,
    imported: cursor.imported + itemsReturned,
    failed: cursor.failed + outcomes.failed,
    partial: cursor.partial + outcomes.partial,
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

/**
 * How far past the slice deadline a page fetch may run before it is aborted.
 *
 * `hasBudget` only gates the START of a page, and a page's POS calls could
 * previously run ~130 s on the 401 path (two fetches, a re-login, two more
 * fetches) against a 75 s lease. The reaper then requeued a run that was still
 * working, the slice's checkpoint failed, and the page was replayed with an
 * attempt burned — a slow POS alone could exhaust every attempt.
 *
 * Safe bound: every lease expires at least DEFAULT_LEASE_MARGIN_SECONDS (30 s)
 * after the slice deadline (claims and checkpoints all happen before it), so a
 * fetch aborted at deadline + 10 s — plus one POS re-login, which the abort
 * cannot interrupt but which has its own 10 s ceiling — still ends inside the
 * lease. The lease is then renewed before any write.
 */
export const PAGE_FETCH_GRACE_MS = 10_000

export function pageFetchDeadline(sliceDeadlineAt: number): number {
  return sliceDeadlineAt + PAGE_FETCH_GRACE_MS
}

/**
 * What a slice does when a page fetch runs out of time.
 *
 * After at least one page this slice, the slice simply ran out of room: yield,
 * which neither advances the cursor nor burns an attempt, and the next slice
 * retries the page with a full budget. On the slice's FIRST page the fetch had
 * that full budget already, so the POS is genuinely too slow — fail, and let
 * the attempt count bound the retries instead of yielding forever.
 */
export function onPageFetchTimeout(
  pagesCompletedThisSlice: number
): "yield" | "fail" {
  return pagesCompletedThisSlice > 0 ? "yield" : "fail"
}
