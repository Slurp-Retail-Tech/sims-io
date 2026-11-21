import type { Metadata } from "next"

import { requirePageAccess } from "@/lib/auth-server"
import { canAccessPath } from "@/lib/page-access"

import { BillingProfilesView } from "./billing-profiles-view"

export const metadata: Metadata = {
  title: "Renewal – Billing Profiles",
}

export default async function BillingProfilesPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string | string[] }>
}) {
  const user = await requirePageAccess([
    "/renewal-retention/billing-profiles",
    "/renewal-retention/billing-profiles/manage",
  ])
  const { q } = await searchParams
  return (
    <BillingProfilesView
      initialSearch={typeof q === "string" ? q.slice(0, 80) : ""}
      canManage={canAccessPath(user.role, user.pageAccess, "/renewal-retention/billing-profiles/manage")}
    />
  )
}
