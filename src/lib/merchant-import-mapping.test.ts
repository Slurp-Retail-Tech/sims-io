import assert from "node:assert/strict"
import test from "node:test"

import {
  isRecordDataError,
  mapPosMerchant,
  MERCHANT_COLUMN_LIMITS,
  summarizeMerchantImport,
  truncateToColumn,
} from "./merchant-import-mapping.ts"

function mapOk(item: unknown) {
  const mapped = mapPosMerchant(item)
  assert.equal(mapped.ok, true)
  if (!mapped.ok) {
    throw new Error("unreachable")
  }
  return mapped
}

test("a well-formed record maps to the same values the importer always wrote", () => {
  const item = {
    id: 42,
    name: "Central Food",
    status: 1,
    outlets: [{ id: 7, name: "KLCC", status: 0 }],
  }
  const mapped = mapOk(item)
  assert.deepEqual(mapped.merchant, {
    externalId: "42",
    name: "Central Food",
    fid: "42",
    outletCount: 1,
    status: "Active",
    rawPayload: JSON.stringify(item),
  })
  assert.deepEqual(mapped.outlets, [
    {
      externalId: "7",
      name: "KLCC",
      status: "Inactive",
      rawPayload: JSON.stringify(item.outlets[0]),
    },
  ])
  assert.deepEqual(mapped.skippedOutlets, [])
})

test("identity keeps its fallback chain, ending at the name", () => {
  assert.equal(mapOk({ fid: "F-9", name: "A" }).merchant.externalId, "F-9")
  assert.equal(mapOk({ code: "C-1", name: "A" }).merchant.externalId, "C-1")
  assert.equal(mapOk({ name: "Only Name" }).merchant.externalId, "Only Name")
  assert.equal(mapOk({}).merchant.externalId, "Unknown Merchant")
})

test("display fields are truncated to their column", () => {
  const longName = "n".repeat(300)
  const mapped = mapOk({ id: 1, name: longName, status: "s".repeat(80) })
  assert.equal(mapped.merchant.name.length, MERCHANT_COLUMN_LIMITS.name)
  assert.equal(mapped.merchant.status?.length, MERCHANT_COLUMN_LIMITS.status)
})

test("truncation counts characters and never splits an emoji", () => {
  const value = "🍜".repeat(5)
  assert.equal(truncateToColumn(value, 3), "🍜🍜🍜")
  assert.equal(truncateToColumn("short", 10), "short")
})

test("an over-long identifier rejects the record instead of truncating it", () => {
  // Truncating could merge two different merchants into one row.
  const mapped = mapPosMerchant({ id: "x".repeat(121), name: "A" })
  assert.equal(mapped.ok, false)
  if (!mapped.ok) {
    assert.match(mapped.reason, /longer than 120/)
  }
})

test("a name-derived identifier that is too long is rejected", () => {
  assert.equal(mapPosMerchant({ name: "n".repeat(130) }).ok, false)
})

test("non-object records and non-scalar ids are rejected, not thrown", () => {
  // Each of these used to throw (or write "[object Object]") and fail the page.
  for (const item of [null, "text", 5, [1, 2]]) {
    const mapped = mapPosMerchant(item)
    assert.equal(mapped.ok, false)
  }
  const objectId = mapPosMerchant({ id: { nested: 1 }, name: "A" })
  assert.equal(objectId.ok, false)
  if (!objectId.ok) {
    assert.equal(objectId.unitKey, "A")
  }
})

test("a non-string name falls through to the next candidate", () => {
  assert.equal(
    mapOk({ id: 1, name: { en: "x" }, franchise_name: "Franchise" }).merchant.name,
    "Franchise"
  )
})

test("bad outlets are skipped with a reason while good ones are kept", () => {
  const mapped = mapOk({
    id: 1,
    outlets: [
      null,
      { name: "No id" },
      { id: "o".repeat(121) },
      { id: { deep: true } },
      { id: 9, name: "Good" },
    ],
  })
  assert.deepEqual(
    mapped.outlets.map((outlet) => outlet.externalId),
    ["9"]
  )
  assert.equal(mapped.skippedOutlets.length, 4)
  assert.match(mapped.skippedOutlets[0], /not an object/)
  assert.match(mapped.skippedOutlets[1], /no id/)
})

test("outlet count is clamped to the INT column", () => {
  assert.equal(mapOk({ id: 1, outlet_count: 1e12 }).merchant.outletCount, 2_147_483_647)
  assert.equal(mapOk({ id: 1, outlets: { id: 1 } }).merchant.outletCount, 1)
})

test("status keeps the previous mapping for numbers and booleans", () => {
  assert.equal(mapOk({ id: 1, status: 3 }).merchant.status, "3")
  assert.equal(mapOk({ id: 1, status: true }).merchant.status, "1")
  assert.equal(mapOk({ id: 1, status: false }).merchant.status, null)
  assert.equal(mapOk({ id: 1, status: { code: 1 } }).merchant.status, null)
})

test("only per-record MySQL data errors are skippable", () => {
  assert.equal(isRecordDataError({ code: "ER_DATA_TOO_LONG" }), true)
  assert.equal(isRecordDataError({ code: "ER_TRUNCATED_WRONG_VALUE_FOR_FIELD" }), true)
  // Infrastructure and code errors must still fail the slice and be retried.
  assert.equal(isRecordDataError({ code: "PROTOCOL_CONNECTION_LOST" }), false)
  assert.equal(isRecordDataError({ code: "ER_PARSE_ERROR" }), false)
  assert.equal(isRecordDataError(new Error("boom")), false)
  assert.equal(isRecordDataError(null), false)
})

test("a clean run succeeds with no message", () => {
  assert.deepEqual(summarizeMerchantImport({ processed: 500, failed: 0, partial: 0 }), {
    status: "succeeded",
    errorMessage: null,
  })
})

test("a few skipped records still succeed, with a note", () => {
  const outcome = summarizeMerchantImport({ processed: 1000, failed: 3, partial: 2 })
  assert.equal(outcome.status, "succeeded")
  assert.match(outcome.errorMessage ?? "", /3 of 1000 merchants could not be imported/)
  assert.match(outcome.errorMessage ?? "", /2 merchants were imported with some outlets skipped/)
})

test("a large share of rejected records fails the run", () => {
  assert.equal(
    summarizeMerchantImport({ processed: 100, failed: 6, partial: 0 }).status,
    "failed"
  )
  // Partial merchants were written, so they never fail the run on their own.
  assert.equal(
    summarizeMerchantImport({ processed: 100, failed: 0, partial: 90 }).status,
    "succeeded"
  )
})
