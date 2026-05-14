export type ApprovalAssignee = {
  id: string
  department: string
  status: string
}

export type ApprovalAssigneeValidation =
  | { ok: true; assigneeId: string }
  | { ok: false; error: string }

export function validateApprovalAssignee(
  assignee: ApprovalAssignee | null
): ApprovalAssigneeValidation {
  if (!assignee) {
    return {
      ok: false,
      error: "MS PIC is required before approving an onboarding appointment.",
    }
  }

  if (assignee.status !== "active" || assignee.department !== "Merchant Success") {
    return {
      ok: false,
      error: "Assignee must be an active Merchant Success user.",
    }
  }

  return { ok: true, assigneeId: String(assignee.id) }
}
