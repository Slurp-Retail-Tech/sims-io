import assert from "node:assert/strict"
import test from "node:test"

import {
  canAccessAnyPath,
  canAccessPath,
  GENERAL_OVERVIEW_PATH,
  getAccessKeysForPath,
  hasPageAccessForPath,
  hasUniversalAccess,
  SUPER_ADMIN_ROLE,
} from "./page-access.ts"

test("universal paths are open to every authenticated user", () => {
  assert.equal(hasUniversalAccess(GENERAL_OVERVIEW_PATH), true)
  assert.equal(hasUniversalAccess("/release-notes/1.2.3"), true)
  assert.equal(hasUniversalAccess("/tickets"), false)
  assert.equal(hasPageAccessForPath("/overview", []), true)
})

test("a person can always reach their own profile and preferences", () => {
  // Linked from the user dropdown for everyone; no grant exists for them in
  // user-management, so requiring a key locked out every non-Super-Admin.
  for (const path of ["/profile", "/preferences"]) {
    assert.equal(hasUniversalAccess(path), true, path)
    assert.equal(hasPageAccessForPath(path, []), true, path)
    assert.equal(canAccessPath("User", [], path), true, path)
    assert.equal(canAccessPath("Admin", [], path), true, path)
  }
})

test("longest prefix wins in the route mappings", () => {
  assert.deepEqual(getAccessKeysForPath("/merchant-success/tickets"), ["/tickets"])
  assert.deepEqual(getAccessKeysForPath("/merchant-success"), ["/merchant-success"])
  assert.deepEqual(getAccessKeysForPath("/sales/overview"), ["/sales/overview"])
  // Legacy workspace-level grant.
  assert.deepEqual(getAccessKeysForPath("/sales"), ["/sales"])
})

test("mapped paths accept any of their access keys", () => {
  assert.equal(
    hasPageAccessForPath("/merchant-success/csat-insights", ["/analytics"]),
    true
  )
  assert.equal(
    hasPageAccessForPath("/merchant-success/csat-insights", ["/csat-insights"]),
    true
  )
  assert.equal(hasPageAccessForPath("/merchant-success/csat-insights", []), false)
})

test("unmapped paths fall back to prefix matching against the grants", () => {
  assert.equal(hasPageAccessForPath("/some/new/page", ["/some"]), true)
  assert.equal(hasPageAccessForPath("/some/new/page", ["/other"]), false)
})

test("canAccessPath centralizes the Super Admin bypass", () => {
  assert.equal(canAccessPath(SUPER_ADMIN_ROLE, [], "/tickets"), true)
  assert.equal(canAccessPath("User", [], "/tickets"), false)
  assert.equal(canAccessPath("User", ["/tickets"], "/tickets"), true)
})

test("canAccessAnyPath ORs over paths", () => {
  assert.equal(
    canAccessAnyPath("User", ["/tickets"], ["/sales/leads", "/tickets"]),
    true
  )
  assert.equal(canAccessAnyPath("User", ["/tickets"], ["/sales/leads"]), false)
  assert.equal(canAccessAnyPath("User", ["/tickets"], []), false)
})

test("trailing slashes normalize", () => {
  assert.equal(hasPageAccessForPath("/tickets/", ["/tickets"]), true)
})

// ---------------------------------------------------------------------------
// Renewal capability keys
//
// `manage` and `approve-override` are grants, not pages. Each needs its own
// mapping in accessRouteMappings: without one, getAccessKeysForPath falls back
// to the longest matching prefix, returns the view key, and silently lets a
// view-only grant through the manage check.
// ---------------------------------------------------------------------------

test("a renewal view grant does not confer manage or approve", () => {
  const viewOnly = ["/renewal-retention/plans"]

  assert.equal(hasPageAccessForPath("/renewal-retention/plans", viewOnly), true)
  assert.equal(
    hasPageAccessForPath("/renewal-retention/plans/manage", viewOnly),
    false
  )
  assert.equal(
    hasPageAccessForPath("/renewal-retention/plans/approve-override", viewOnly),
    false
  )
})

test("a renewal manage grant does not confer override approval", () => {
  // Approving an override above the variance threshold is a separate control
  // from editing a plan, and must stay separate.
  const manager = ["/renewal-retention/plans", "/renewal-retention/plans/manage"]

  assert.equal(
    hasPageAccessForPath("/renewal-retention/plans/manage", manager),
    true
  )
  assert.equal(
    hasPageAccessForPath("/renewal-retention/plans/approve-override", manager),
    false
  )
})

test("an override approver holds only what it was granted", () => {
  const approver = ["/renewal-retention/plans/approve-override"]

  assert.equal(
    hasPageAccessForPath("/renewal-retention/plans/approve-override", approver),
    true
  )
  assert.equal(
    hasPageAccessForPath("/renewal-retention/plans/manage", approver),
    false
  )
  // The approve grant alone does not open the page it approves on.
  assert.equal(hasPageAccessForPath("/renewal-retention/plans", approver), false)
})

test("the legacy workspace grant still opens the renewal plans page", () => {
  // /renewal-retention is a pre-existing workspace-level grant, and the new
  // page must not silently fall outside it.
  assert.equal(
    hasPageAccessForPath("/renewal-retention/plans", ["/renewal-retention"]),
    false
  )
})

test("renewal plan routes resolve to their own key, not a parent prefix", () => {
  assert.deepEqual(getAccessKeysForPath("/renewal-retention/plans"), [
    "/renewal-retention/plans",
  ])
  assert.deepEqual(getAccessKeysForPath("/renewal-retention/plans/manage"), [
    "/renewal-retention/plans/manage",
  ])
  assert.deepEqual(
    getAccessKeysForPath("/renewal-retention/plans/approve-override"),
    ["/renewal-retention/plans/approve-override"]
  )
})

test("designating a renewal PIC needs its own grant, not the contacts key", () => {
  // Editing the contact directory and deciding who a merchant's invoice is
  // addressed to are different authorities.
  const contactsOnly = ["/contacts"]
  assert.equal(
    hasPageAccessForPath("/renewal-retention/subscriptions/manage", contactsOnly),
    false
  )

  const renewalManager = ["/renewal-retention/subscriptions/manage"]
  assert.equal(
    hasPageAccessForPath("/renewal-retention/subscriptions/manage", renewalManager),
    true
  )
  // And it does not leak sideways into the plan catalog.
  assert.equal(
    hasPageAccessForPath("/renewal-retention/plans/manage", renewalManager),
    false
  )
})
