import assert from "node:assert/strict"
import test from "node:test"

import {
  pickMerchantNames,
  resolveMerchantNames,
} from "./merchant-outlet-resolution.ts"

test("prefers the franchise-keyed row for both names", () => {
  assert.deepEqual(
    pickMerchantNames(
      { franchiseName: "Teh Tarik House", outletName: "Mid Valley" },
      { franchiseName: "Wrong Franchise", outletName: "Wrong Outlet" }
    ),
    { franchiseName: "Teh Tarik House", outletName: "Mid Valley" }
  )
})

test("fills a missing outlet name from the outlet-keyed fallback", () => {
  // The franchise query LEFT JOINs the outlet, so it yields a null outlet name when
  // the outlet belongs to a different merchant. Reporting "not found" there would be
  // wrong — the outlet exists, it is just linked elsewhere.
  assert.deepEqual(
    pickMerchantNames(
      { franchiseName: "Teh Tarik House", outletName: null },
      { franchiseName: "Kopitiam Sentral", outletName: "Mid Valley" }
    ),
    { franchiseName: "Teh Tarik House", outletName: "Mid Valley" }
  )
})

test("uses the fallback entirely when the franchise lookup found nothing", () => {
  assert.deepEqual(
    pickMerchantNames(null, {
      franchiseName: "Kopitiam Sentral",
      outletName: "Bukit Bintang",
    }),
    { franchiseName: "Kopitiam Sentral", outletName: "Bukit Bintang" }
  )
})

test("keeps the franchise name when there is no fallback (franchise-only lookup)", () => {
  assert.deepEqual(
    pickMerchantNames({ franchiseName: "Teh Tarik House", outletName: null }, null),
    { franchiseName: "Teh Tarik House", outletName: null }
  )
})

test("returns both names null when nothing resolved", () => {
  assert.deepEqual(pickMerchantNames(null, null), {
    franchiseName: null,
    outletName: null,
  })
})

// resolveMerchantNames runs inside an open transaction on the Respond.io ingest
// path, so both its query budget and the fact that it uses the caller's
// connection are load-bearing. A stub Queryable pins both without a database.
function createStubDb(rows: Array<Array<Record<string, unknown>>>) {
  const queries: string[] = []
  let call = 0
  const db = {
    async query(sql: string) {
      queries.push(sql)
      const result = rows[call] ?? []
      call += 1
      return [result, []] as never
    },
  }
  return { db: db as never, queries }
}

test("skips the outlet fallback when the franchise query answered both names", async () => {
  const { db, queries } = createStubDb([
    [{ franchise_name: "Teh Tarik House", outlet_name: "Mid Valley" }],
  ])

  const names = await resolveMerchantNames(db, "F123", "01")

  assert.deepEqual(names, {
    franchiseName: "Teh Tarik House",
    outletName: "Mid Valley",
  })
  assert.equal(queries.length, 1)
})

test("falls back to the outlet-keyed query when the outlet name is missing", async () => {
  const { db, queries } = createStubDb([
    [{ franchise_name: "Teh Tarik House", outlet_name: null }],
    [{ franchise_name: "Kopitiam Sentral", outlet_name: "Mid Valley" }],
  ])

  const names = await resolveMerchantNames(db, "F123", "01")

  assert.deepEqual(names, {
    franchiseName: "Teh Tarik House",
    outletName: "Mid Valley",
  })
  assert.equal(queries.length, 2)
})

test("issues no query at all when neither fid nor oid is usable", async () => {
  const { db, queries } = createStubDb([])

  assert.deepEqual(await resolveMerchantNames(db, "  ", null), {
    franchiseName: null,
    outletName: null,
  })
  assert.equal(queries.length, 0)
})
