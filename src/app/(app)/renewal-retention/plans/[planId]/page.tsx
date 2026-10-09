import { requirePageAccess } from "@/lib/auth-server"
import { canAccessPath } from "@/lib/page-access"

import { PlanDetailView } from "./plan-detail-view"

/**
 * One plan: its prices, and everyone assigned to it. Guarded server-side by
 * the same three renewal plan keys as the catalog list, since this is just
 * the catalog's own drill-down rather than a separate surface.
 */
export default async function PlanDetailPage({
  params,
}: {
  params: Promise<{ planId: string }>
}) {
  const user = await requirePageAccess([
    "/renewal-retention/plans",
    "/renewal-retention/plans/manage",
    "/renewal-retention/plans/approve-override",
  ])

  const { planId } = await params
  return (
    <PlanDetailView
      planId={planId}
      canManage={canAccessPath(user.role, user.pageAccess, "/renewal-retention/plans/manage")}
    />
  )
}
