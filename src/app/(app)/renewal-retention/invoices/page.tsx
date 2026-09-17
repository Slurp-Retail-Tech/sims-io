import { requirePageAccess } from "@/lib/auth-server"

import { InvoiceListView } from "./invoice-list-view"

export default async function RenewalInvoicesPage() {
  await requirePageAccess([
    "/renewal-retention/invoices",
    "/renewal-retention/invoices/manage",
  ])

  return <InvoiceListView />
}
