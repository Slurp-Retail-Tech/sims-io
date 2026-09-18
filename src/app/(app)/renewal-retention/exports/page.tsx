import type { Metadata } from "next"

import { requirePageAccess } from "@/lib/auth-server"
import { canAccessPath } from "@/lib/page-access"

import { ExportsView } from "./exports-view"

export const metadata: Metadata = {
  title: "Renewal – Bukku Export",
}

export default async function BukkuExportPage() {
  const user = await requirePageAccess([
    "/renewal-retention/exports",
    "/renewal-retention/exports/manage",
  ])
  return (
    <ExportsView
      canManage={canAccessPath(user.role, user.pageAccess, "/renewal-retention/exports/manage")}
    />
  )
}
