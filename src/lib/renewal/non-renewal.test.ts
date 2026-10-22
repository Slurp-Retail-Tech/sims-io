import assert from "node:assert/strict"
import test from "node:test"

import { isNonRenewalReason, NON_RENEWAL_REASONS, nonRenewalLabel, validateNonRenewal } from "./non-renewal.ts"

test("the list is the team's five reasons plus Other", () => {
  assert.deepEqual(
    NON_RENEWAL_REASONS.map((reason) => reason.value),
    ["change_of_ownership", "closed_business", "switched_system", "freeze_account", "temp_close", "other"]
  )
  assert.deepEqual(
    NON_RENEWAL_REASONS.filter((reason) => reason.temporary).map((reason) => reason.value),
    ["freeze_account", "temp_close"]
  )
})

test("Other needs a note; the named reasons do not", () => {
  assert.match(validateNonRenewal("other", null) ?? "", /note/)
  assert.match(validateNonRenewal("other", "   ") ?? "", /note/)
  assert.equal(validateNonRenewal("other", "Owner passed away"), null)
  assert.equal(validateNonRenewal("closed_business", null), null)
})

test("labels and guards", () => {
  assert.equal(nonRenewalLabel("temp_close"), "Temporarily closed")
  assert.equal(nonRenewalLabel("unknown"), "unknown")
  assert.equal(isNonRenewalReason("switched_system"), true)
  assert.equal(isNonRenewalReason("bankrupt"), false)
})
