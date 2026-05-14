import assert from "node:assert/strict"
import test from "node:test"

import {
  buildMerchantOptionsSearch,
  buildMerchantOutletResolver,
  mapMerchantOption,
} from "./merchant-lookup.ts"

test("maps merchant option company from company_name when company is absent", () => {
  assert.deepEqual(
    mapMerchantOption({
      id: "12",
      external_id: "external-12",
      name: "Nasi Kandar Central",
      fid: "4321",
      raw_payload: JSON.stringify({ company_name: "Central Food Sdn Bhd" }),
    }),
    {
      id: "12",
      externalId: "external-12",
      name: "Nasi Kandar Central",
      fid: "4321",
      company: "Central Food Sdn Bhd",
    }
  )
})

test("builds merchant option search with the same fields as the merchants page", () => {
  const search = buildMerchantOptionsSearch(" Central Food ", 25)

  assert.match(search.whereSql, /LOWER\(name\) LIKE \?/)
  assert.match(search.whereSql, /LOWER\(fid\) LIKE \?/)
  assert.match(search.whereSql, /LOWER\(external_id\) LIKE \?/)
  assert.match(search.whereSql, /LOWER\(CAST\(raw_payload AS CHAR\)\) LIKE \?/)
  assert.match(search.whereSql, /FROM merchant_outlets/)
  assert.match(search.whereSql, /LOWER\(merchant_outlets\.name\) LIKE \?/)
  assert.match(
    search.whereSql,
    /LOWER\(CAST\(merchant_outlets\.raw_payload AS CHAR\)\) LIKE \?/
  )
  assert.deepEqual(search.values, [
    "%central food%",
    "%central food%",
    "%central food%",
    "%central food%",
    "%central food%",
    "%central food%",
    25,
  ])
})

test("builds outlet merchant resolver for database id, fid, or external id", () => {
  const resolver = buildMerchantOutletResolver("merchant-123")

  assert.match(resolver.sql, /WHERE id = \? OR fid = \? OR external_id = \?/)
  assert.deepEqual(resolver.values, [
    "merchant-123",
    "merchant-123",
    "merchant-123",
  ])
})
