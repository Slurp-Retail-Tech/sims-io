import assert from "node:assert/strict"
import test from "node:test"

import { buildDriftAction, decideAcceptPosDate } from "./pos-drift.ts"

const drift = {
  franchiseId: "501",
  outletId: "3",
  simsValidUntil: "2027-10-15 00:00:00.000",
  posValidUntil: "2028-01-01 00:00:00.000",
}

test("the entry names both dates and both remedies", () => {
  const action = buildDriftAction(drift, null)
  assert.equal(action.outletId, "3")
  assert.equal(action.invoiceId, null)
  assert.match(action.detail, /running to 2028-01-01; SIMS extended it to 2027-10-15/)
  assert.match(action.detail, /accept the POS date/)
  assert.match(action.detail, /correct it there/)
})

test("an open proforma for the outlet is named, because it may bill a paid renewal", () => {
  const action = buildDriftAction(drift, { invoiceId: "42", invoiceNumber: "PI-2027/10-004" })
  assert.equal(action.invoiceId, "42")
  assert.match(action.detail, /PI-2027\/10-004 is open for this outlet/)
})

test("the POS date is accepted only when it is still ahead", () => {
  assert.deepEqual(decideAcceptPosDate(drift.simsValidUntil, drift.posValidUntil), {
    ok: true,
    validUntil: drift.posValidUntil,
  })
  // Converged since the entry was raised: nothing to accept.
  assert.deepEqual(decideAcceptPosDate(drift.posValidUntil, drift.posValidUntil), { ok: false, reason: "not_later" })
  // Never backwards: that would shorten a paid licence.
  assert.deepEqual(decideAcceptPosDate(drift.posValidUntil, drift.simsValidUntil), { ok: false, reason: "not_later" })
  assert.deepEqual(decideAcceptPosDate(drift.simsValidUntil, null), { ok: false, reason: "no_pos_date" })
})
