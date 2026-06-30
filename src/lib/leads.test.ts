import assert from "node:assert/strict"
import test from "node:test"

import { canEditLead, canViewLead, leadScopeClause, type LeadAuthUser } from "./leads.ts"

const manager: LeadAuthUser = {
  id: "1",
  name: "Admin",
  email: "a@x.com",
  role: "Admin",
  department: "Sales & Marketing",
  pageAccess: [],
}

const agent: LeadAuthUser = {
  id: "7",
  name: "Agent",
  email: "u@x.com",
  role: "User",
  department: "Sales & Marketing",
  pageAccess: [],
}

test("managers get an empty scope clause (see everything)", () => {
  assert.deepEqual(leadScopeClause(manager, "leads.assigned_user_id"), {
    clause: "",
    params: [],
  })
})

test("users are scoped to their own assigned leads", () => {
  assert.deepEqual(leadScopeClause(agent, "leads.assigned_user_id"), {
    clause: "leads.assigned_user_id = ?",
    params: ["7"],
  })
})

test("managers can view and edit any lead", () => {
  assert.equal(canViewLead(manager, { assigned_user_id: null }), true)
  assert.equal(canEditLead(manager, { assigned_user_id: "999" }), true)
})

test("users can only view/edit leads assigned to them", () => {
  assert.equal(canViewLead(agent, { assigned_user_id: "7" }), true)
  assert.equal(canViewLead(agent, { assigned_user_id: "8" }), false)
  assert.equal(canViewLead(agent, { assigned_user_id: null }), false)
})
