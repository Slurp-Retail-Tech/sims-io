import { requirePageAccess } from "@/lib/auth-server"
import { canAccessPath } from "@/lib/page-access"

import { PlanCatalogView } from "./plan-catalog-view"

/**
 * The plan catalog.
 *
 * Guarded server-side rather than relying on the sidebar filter: the sidebar
 * decides what to show, not what may be reached. Any of the three renewal plan
 * keys opens the page, and the two capability keys are resolved here and
 * handed down, so the client never decides for itself what it may do.
 */
export default async function RenewalPlansPage() {
  const user = await requirePageAccess([
    "/renewal-retention/plans",
    "/renewal-retention/plans/manage",
    "/renewal-retention/plans/approve-override",
  ])

  return (
    <PlanCatalogView
      canManage={canAccessPath(
        user.role,
        user.pageAccess,
        "/renewal-retention/plans/manage"
      )}
      canApprove={canAccessPath(
        user.role,
        user.pageAccess,
        "/renewal-retention/plans/approve-override"
      )}
    />
  )
}
