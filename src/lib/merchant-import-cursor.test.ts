import assert from "node:assert/strict"
import test from "node:test"

import { DEFAULT_LEASE_MARGIN_SECONDS } from "./job-runner-core.ts"
import {
  advancePageCursor,
  INITIAL_MERCHANT_IMPORT_CURSOR,
  onPageFetchTimeout,
  PAGE_FETCH_GRACE_MS,
  pageFetchDeadline,
  parseMerchantImportCursor,
} from "./merchant-import-cursor.ts"
import { POS_AUTH_TIMEOUT_MS } from "./pos-api.ts"

const start = INITIAL_MERCHANT_IMPORT_CURSOR

test("a full page advances and continues", () => {
  assert.deepEqual(advancePageCursor(start, 100, 100, 500), {
    cursor: { page: 2, imported: 100, failed: 0, partial: 0 },
    done: false,
    reason: null,
  })
})

test("a short page ends the run", () => {
  assert.deepEqual(advancePageCursor({ page: 3, imported: 200, failed: 0, partial: 0 }, 42, 100, 500), {
    cursor: { page: 4, imported: 242, failed: 0, partial: 0 },
    done: true,
    reason: "short-page",
  })
})

test("an empty page ends the run", () => {
  assert.deepEqual(advancePageCursor({ page: 3, imported: 200, failed: 0, partial: 0 }, 0, 100, 500), {
    cursor: { page: 4, imported: 200, failed: 0, partial: 0 },
    done: true,
    reason: "empty",
  })
})

test("hitting the page cap ends the run and says so", () => {
  // The guard the previous `while (hasMore)` loop lacked: a POS endpoint that
  // keeps returning full pages would otherwise loop until the request died.
  assert.deepEqual(advancePageCursor({ page: 500, imported: 50_000, failed: 0, partial: 0 }, 100, 100, 500), {
    cursor: { page: 501, imported: 50_100, failed: 0, partial: 0 },
    done: true,
    reason: "max-pages",
  })
})

test("the cap does not fire one page early", () => {
  const result = advancePageCursor({ page: 499, imported: 0, failed: 0, partial: 0 }, 100, 100, 500)
  assert.equal(result.done, false)
  assert.equal(result.cursor.page, 500)
})

test("imported accumulates across slices", () => {
  let cursor = start
  for (let i = 0; i < 3; i += 1) {
    cursor = advancePageCursor(cursor, 100, 100, 500).cursor
  }
  assert.deepEqual(cursor, { page: 4, imported: 300, failed: 0, partial: 0 })
})

test("a malformed stored cursor falls back to page 1", () => {
  assert.deepEqual(parseMerchantImportCursor(null), start)
  assert.deepEqual(parseMerchantImportCursor({ page: 0 }), start)
  assert.deepEqual(parseMerchantImportCursor({ page: -3 }), start)
  assert.deepEqual(parseMerchantImportCursor({ page: 1.5 }), start)
  // A valid page with a junk count keeps the page and resets the count.
  assert.deepEqual(parseMerchantImportCursor({ page: 7, imported: "x" }), {
    page: 7,
    imported: 0,
    failed: 0,
    partial: 0,
  })
})

test("a cursor stored before failure totals existed resumes with zero totals", () => {
  assert.deepEqual(parseMerchantImportCursor({ page: 4, imported: 300 }), {
    page: 4,
    imported: 300,
    failed: 0,
    partial: 0,
  })
})

test("failure totals accumulate across pages", () => {
  let cursor = start
  cursor = advancePageCursor(cursor, 100, 100, 500, { failed: 2, partial: 1 }).cursor
  cursor = advancePageCursor(cursor, 100, 100, 500, { failed: 1, partial: 0 }).cursor
  assert.deepEqual(cursor, { page: 3, imported: 200, failed: 3, partial: 1 })
  assert.deepEqual(parseMerchantImportCursor(JSON.parse(JSON.stringify(cursor))), cursor)
})

test("a page fetch that overruns always ends inside the lease", () => {
  // Every lease outlives the slice deadline by the margin. A fetch aborted at
  // the grace limit can still be followed by one uninterruptible POS re-login,
  // so both must fit inside the margin or MI-04 comes back.
  assert.ok(PAGE_FETCH_GRACE_MS + POS_AUTH_TIMEOUT_MS < DEFAULT_LEASE_MARGIN_SECONDS * 1000)
  assert.equal(pageFetchDeadline(1_000_000), 1_000_000 + PAGE_FETCH_GRACE_MS)
})

test("a fetch timeout yields after progress but fails on the slice's first page", () => {
  // Yielding on the first page would retry a too-slow POS forever without
  // ever using up an attempt.
  assert.equal(onPageFetchTimeout(0), "fail")
  assert.equal(onPageFetchTimeout(1), "yield")
  assert.equal(onPageFetchTimeout(12), "yield")
})
