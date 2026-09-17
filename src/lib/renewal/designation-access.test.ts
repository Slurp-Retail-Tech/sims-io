import assert from "node:assert/strict"
import test from "node:test"

import { evaluateDesignationAccess } from "./designation-access.ts"

const user = (pageAccess: string[], role = "User") => ({ role, pageAccess })

test("both keys together are allowed", () => {
  assert.deepEqual(
    evaluateDesignationAccess(
      user(["/contacts", "/renewal-retention/subscriptions/manage"])
    ),
    { allowed: true }
  )
})

test("the subscriptions key alone is refused", () => {
  // The audit finding: a renewal-only role must not be able to redirect an
  // invoice by editing a contact it cannot otherwise see.
  assert.deepEqual(
    evaluateDesignationAccess(user(["/renewal-retention/subscriptions/manage"])),
    { allowed: false, missing: "contacts" }
  )
})

test("the contacts key alone is refused", () => {
  assert.deepEqual(evaluateDesignationAccess(user(["/contacts"])), {
    allowed: false,
    missing: "subscriptions_manage",
  })
})

test("a view-only renewal grant does not satisfy the manage key", () => {
  // Longest-prefix fallback must not let /renewal-retention pass a /manage
  // check; the capability key is registered explicitly for this reason.
  assert.equal(
    evaluateDesignationAccess(user(["/contacts", "/renewal-retention"])).allowed,
    false
  )
})

test("Super Admin passes without either key", () => {
  assert.deepEqual(evaluateDesignationAccess(user([], "Super Admin")), {
    allowed: true,
  })
})
