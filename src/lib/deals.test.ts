import assert from "node:assert/strict"
import test from "node:test"

import { reconcileDealFields } from "./deals.ts"

test("non-terminal stage clears closed date, close lost reason and remarks", () => {
  const result = reconcileDealFields({
    stage: "Demo Scheduled",
    amount: 1000,
    closedDate: "2026-06-29",
    closeLostReason: "Low Budget",
    closeLostRemarks: "Should be dropped",
  })
  assert.deepEqual(result, {
    ok: true,
    closedDate: null,
    closeLostReason: null,
    closeLostRemarks: null,
  })
})

test("Closed Won keeps closed date but clears close lost reason and remarks", () => {
  const result = reconcileDealFields({
    stage: "Closed Won",
    amount: 1000,
    closedDate: "2026-06-29",
    closeLostReason: "Low Budget",
    closeLostRemarks: "Should be dropped",
  })
  assert.deepEqual(result, {
    ok: true,
    closedDate: "2026-06-29",
    closeLostReason: null,
    closeLostRemarks: null,
  })
})

test("Closed Won requires a closed date", () => {
  const result = reconcileDealFields({
    stage: "Closed Won",
    amount: 1000,
    closedDate: null,
    closeLostReason: null,
  })
  assert.equal(result.ok, false)
})

test("Closed Lost keeps closed date, reason and remarks", () => {
  const result = reconcileDealFields({
    stage: "Closed Lost",
    amount: 0,
    closedDate: "2026-06-29",
    closeLostReason: "KDS",
    closeLostRemarks: "Merchant already committed elsewhere",
  })
  assert.deepEqual(result, {
    ok: true,
    closedDate: "2026-06-29",
    closeLostReason: "KDS",
    closeLostRemarks: "Merchant already committed elsewhere",
  })
})

test("Closed Lost defaults remarks to null when omitted", () => {
  const result = reconcileDealFields({
    stage: "Closed Lost",
    amount: 0,
    closedDate: "2026-06-29",
    closeLostReason: "KDS",
  })
  assert.deepEqual(result, {
    ok: true,
    closedDate: "2026-06-29",
    closeLostReason: "KDS",
    closeLostRemarks: null,
  })
})

test("Closed Lost requires a close lost reason", () => {
  const result = reconcileDealFields({
    stage: "Closed Lost",
    amount: 100,
    closedDate: "2026-06-29",
    closeLostReason: null,
  })
  assert.equal(result.ok, false)
})

test("negative amount is rejected", () => {
  const result = reconcileDealFields({
    stage: "To Qualify",
    amount: -5,
    closedDate: null,
    closeLostReason: null,
  })
  assert.equal(result.ok, false)
})
