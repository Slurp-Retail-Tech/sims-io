import { requirePageAccess } from "@/lib/auth-server"
import { canAccessPath } from "@/lib/page-access"

import { SettingsView } from "./settings-view"

export default async function RenewalSettingsPage() {
  const user = await requirePageAccess([
    "/renewal-retention/settings",
    "/renewal-retention/settings/manage",
  ])

  return (
    <SettingsView
      canManage={canAccessPath(user.role, user.pageAccess, "/renewal-retention/settings/manage")}
    />
  )
}
