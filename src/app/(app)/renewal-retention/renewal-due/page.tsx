import { requirePageAccess } from "@/lib/auth-server"
import { canAccessPath } from "@/lib/page-access"
import { countOpenBlockingActions } from "@/lib/renewal/actions-required"

import { RenewalListView } from "./renewal-list-view"

export default async function RenewalListPage() {
  const user = await requirePageAccess(["/renewal-retention/renewal-due"])
  const actionCount = await countOpenBlockingActions().catch(() => 0)
  return (
    <RenewalListView
      actionCount={actionCount}
      canCreate={canAccessPath(user.role, user.pageAccess, "/renewal-retention/invoices/manage")}
    />
  )
}
