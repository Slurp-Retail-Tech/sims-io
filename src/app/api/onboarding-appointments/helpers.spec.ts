import assert from "node:assert/strict"
import test from "node:test"

import { validateApprovalAssignee } from "../../../lib/onboarding-appointment-review.ts"

test("approval requires an assigned MS PIC", () => {
  assert.deepEqual(validateApprovalAssignee(null), {
    ok: false,
    error: "MS PIC is required before approving an onboarding appointment.",
  })
})

test("approval accepts an active Merchant Success assignee", () => {
  assert.deepEqual(
    validateApprovalAssignee({
      id: "7",
      department: "Merchant Success",
      status: "active",
    }),
    { ok: true, assigneeId: "7" }
  )
})

test("approval rejects inactive or non-Merchant Success assignees", () => {
  assert.deepEqual(
    validateApprovalAssignee({
      id: "8",
      department: "Sales",
      status: "active",
    }),
    {
      ok: false,
      error: "Assignee must be an active Merchant Success user.",
    }
  )

  assert.deepEqual(
    validateApprovalAssignee({
      id: "9",
      department: "Merchant Success",
      status: "inactive",
    }),
    {
      ok: false,
      error: "Assignee must be an active Merchant Success user.",
    }
  )
})
