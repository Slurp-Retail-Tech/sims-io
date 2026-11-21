import { requirePageAccess } from "@/lib/auth-server"
import { canAccessPath } from "@/lib/page-access"

import { InvoiceListView } from "./invoice-list-view"

export default async function RenewalInvoicesPage() {
  const user = await requirePageAccess([
    "/renewal-retention/invoices",
    "/renewal-retention/invoices/manage",
  ])

  return <InvoiceListView canCreate={canAccessPath(user.role, user.pageAccess, "/renewal-retention/invoices/manage")} />
}
