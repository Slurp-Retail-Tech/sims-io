import { requirePageAccess } from "@/lib/auth-server"
import { canAccessPath } from "@/lib/page-access"
import { evaluateDesignationAccess } from "@/lib/renewal/designation-access"

import { ActionsRequiredView } from "./actions-required-view"

export default async function ActionsRequiredPage() {
  const user = await requirePageAccess([
    "/renewal-retention/actions-required",
    "/renewal-retention/actions-required/manage",
  ])

  return (
    <ActionsRequiredView
      canManage={canAccessPath(
        user.role,
        user.pageAccess,
        "/renewal-retention/actions-required/manage"
      )}
      canAcceptPosDate={canAccessPath(
        user.role,
        user.pageAccess,
        "/renewal-retention/subscriptions/manage"
      )}
      canAssignPlan={canAccessPath(user.role, user.pageAccess, "/renewal-retention/plans/manage")}
      // Both keys the designation endpoint requires.
      canSetPic={evaluateDesignationAccess(user).allowed}
      // Same gate as the manual path of POST /api/renewals/cycle.
      canCheckNow={
        (user.role === "Admin" || user.role === "Super Admin") &&
        canAccessPath(user.role, user.pageAccess, "/renewal-retention/invoices")
      }
    />
  )
}
