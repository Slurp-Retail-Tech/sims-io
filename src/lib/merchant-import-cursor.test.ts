import assert from "node:assert/strict"
import test from "node:test"

import {
  advancePageCursor,
  INITIAL_MERCHANT_IMPORT_CURSOR,
  parseMerchantImportCursor,
} from "./merchant-import-cursor.ts"

const start = INITIAL_MERCHANT_IMPORT_CURSOR

test("a full page advances and continues", () => {
  assert.deepEqual(advancePageCursor(start, 100, 100, 500), {
    cursor: { page: 2, imported: 100 },
    done: false,
    reason: null,
  })
})

test("a short page ends the run", () => {
  assert.deepEqual(advancePageCursor({ page: 3, imported: 200 }, 42, 100, 500), {
    cursor: { page: 4, imported: 242 },
    done: true,
    reason: "short-page",
  })
})

test("an empty page ends the run", () => {
  assert.deepEqual(advancePageCursor({ page: 3, imported: 200 }, 0, 100, 500), {
    cursor: { page: 4, imported: 200 },
    done: true,
    reason: "empty",
  })
})

test("hitting the page cap ends the run and says so", () => {
  // The guard the previous `while (hasMore)` loop lacked: a POS endpoint that
  // keeps returning full pages would otherwise loop until the request died.
  assert.deepEqual(advancePageCursor({ page: 500, imported: 50_000 }, 100, 100, 500), {
    cursor: { page: 501, imported: 50_100 },
    done: true,
    reason: "max-pages",
  })
})

test("the cap does not fire one page early", () => {
  const result = advancePageCursor({ page: 499, imported: 0 }, 100, 100, 500)
  assert.equal(result.done, false)
  assert.equal(result.cursor.page, 500)
})

test("imported accumulates across slices", () => {
  let cursor = start
  for (let i = 0; i < 3; i += 1) {
    cursor = advancePageCursor(cursor, 100, 100, 500).cursor
  }
  assert.deepEqual(cursor, { page: 4, imported: 300 })
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
  })
})
