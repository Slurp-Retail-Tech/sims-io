import assert from "node:assert/strict"
import test from "node:test"

import { buildStaleProformaActions } from "./stale-proforma.ts"
import type { StaleProformaRow } from "./stale-proforma.ts"

function row(overrides: Partial<StaleProformaRow> = {}): StaleProformaRow {
  return {
    invoiceId: "14",
    invoiceNumber: "PI-2026/09-014",
    franchiseId: "11007",
    outletId: "24131",
    outletName: "Teh Tarik House, Setapak",
    invoicedFrom: "2026-10-02",
    currentExpiry: "2026-10-05",
    ...overrides,
  }
}

test("nothing drifted means nothing to work", () => {
  assert.deepEqual(buildStaleProformaActions([]), [])
})

test("a single-outlet invoice is keyed to that outlet and names both dates", () => {
  const [action] = buildStaleProformaActions([row()])
  assert.equal(action.invoiceId, "14")
  assert.equal(action.franchiseId, "11007")
  assert.equal(action.outletId, "24131")
  assert.match(action.detail, /PI-2026\/09-014/)
  assert.match(action.detail, /Teh Tarik House, Setapak/)
  assert.match(action.detail, /2026-10-02/)
  assert.match(action.detail, /2026-10-05/)
  // The merchant may be paying it right now; never tell anyone to void blindly.
  assert.match(action.detail, /unless it is being paid/)
})

test("a grouped invoice is one entry at franchise level, not one per outlet", () => {
  // One document to void is one thing to do, however many of its lines moved.
  const actions = buildStaleProformaActions([
    row({ outletId: "24131", outletName: "Setapak", currentExpiry: "2026-10-05" }),
    row({ outletId: "24132", outletName: "Bangsar", currentExpiry: "2026-10-07" }),
  ])
  assert.equal(actions.length, 1)
  assert.equal(actions[0].outletId, null)
  assert.match(actions[0].detail, /2 of its outlets/)
  assert.match(actions[0].detail, /Setapak now 2026-10-05/)
  assert.match(actions[0].detail, /Bangsar now 2026-10-07/)
})

test("two stale invoices are two entries, each naming its own document", () => {
  const actions = buildStaleProformaActions([
    row({ invoiceId: "14", invoiceNumber: "PI-2026/09-014", outletId: "24131" }),
    row({ invoiceId: "15", invoiceNumber: "PI-2026/09-015", outletId: "24132" }),
  ])
  assert.deepEqual(actions.map((a) => a.invoiceId), ["14", "15"])
  assert.match(actions[0].detail, /PI-2026\/09-014/)
  assert.match(actions[1].detail, /PI-2026\/09-015/)
})

test("an outlet with no name falls back to its id rather than reading blank", () => {
  const [action] = buildStaleProformaActions([row({ outletName: null })])
  assert.match(action.detail, /outlet 24131/)
})
