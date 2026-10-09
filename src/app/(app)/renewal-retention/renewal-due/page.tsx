import { requirePageAccess } from "@/lib/auth-server"
import { countOpenBlockingActions } from "@/lib/renewal/actions-required"

import { RenewalListView } from "./renewal-list-view"

export default async function RenewalListPage() {
  await requirePageAccess(["/renewal-retention/renewal-due"])
  const actionCount = await countOpenBlockingActions().catch(() => 0)
  return <RenewalListView actionCount={actionCount} />
}
