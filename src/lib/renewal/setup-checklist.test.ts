import assert from "node:assert/strict"
import test from "node:test"

import { buildSetupChecklist } from "./setup-checklist.ts"
import type { ChecklistInput } from "./setup-checklist.ts"

const none = { noPlan: 0, noPic: 0, ambiguousPic: 0, unreachablePic: 0 }

function input(overrides: Partial<ChecklistInput> = {}): ChecklistInput {
  return {
    sellerConfigured: false,
    activePlanCount: 0,
    checkHasSucceeded: false,
    open: none,
    ...overrides,
  }
}

const stateOf = (list: ReturnType<typeof buildSetupChecklist>, key: string) =>
  list.steps.find((step) => step.key === key)?.state

test("a fresh install has nothing done and nothing it can yet confirm", () => {
  const list = buildSetupChecklist(input())
  assert.equal(list.complete, false)
  assert.equal(list.doneCount, 0)
  assert.equal(stateOf(list, "company"), "todo")
  assert.equal(stateOf(list, "plan"), "todo")
  // Before any check, an empty queue proves nothing. Never "done".
  assert.equal(stateOf(list, "assigned"), "not_checked")
  assert.equal(stateOf(list, "pic"), "not_checked")
  assert.equal(stateOf(list, "reachable"), "not_checked")
  assert.equal(stateOf(list, "first_check"), "todo")
})

test("the steps run in the order a person has to do them", () => {
  assert.deepEqual(
    buildSetupChecklist(input()).steps.map((step) => step.key),
    ["company", "plan", "assigned", "pic", "reachable", "first_check"]
  )
})

test("after a check, open gaps are to-dos and their counts are named", () => {
  const list = buildSetupChecklist(
    input({ checkHasSucceeded: true, open: { noPlan: 3, noPic: 1, ambiguousPic: 1, unreachablePic: 0 } })
  )
  assert.equal(stateOf(list, "assigned"), "todo")
  assert.match(list.steps.find((s) => s.key === "assigned")!.detail, /3 outlets/)
  // An ambiguous franchise PIC is a PIC gap too.
  assert.equal(stateOf(list, "pic"), "todo")
  assert.match(list.steps.find((s) => s.key === "pic")!.detail, /2 outlets/)
  assert.equal(stateOf(list, "reachable"), "done")
})

test("everything configured and checked is complete", () => {
  const list = buildSetupChecklist(
    input({ sellerConfigured: true, activePlanCount: 2, checkHasSucceeded: true, open: none })
  )
  assert.equal(list.complete, true)
  assert.equal(list.doneCount, 6)
})

test("the plan-gap step links to the queue when outlets are missing a plan", () => {
  const list = buildSetupChecklist(input({ checkHasSucceeded: true, open: { ...none, noPlan: 1 } }))
  assert.equal(list.steps.find((s) => s.key === "assigned")!.href, "/renewal-retention/actions-required")
  assert.match(list.steps.find((s) => s.key === "assigned")!.detail, /1 outlet expiring soon has/)
})
