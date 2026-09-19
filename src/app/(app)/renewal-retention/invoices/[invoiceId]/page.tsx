import { requirePageAccess } from "@/lib/auth-server"
import { canAccessPath } from "@/lib/page-access"

import { InvoiceDetailView } from "./invoice-detail-view"

export default async function InvoiceDetailPage({
  params,
}: {
  params: Promise<{ invoiceId: string }>
}) {
  const user = await requirePageAccess([
    "/renewal-retention/invoices",
    "/renewal-retention/invoices/manage",
  ])

  const { invoiceId } = await params
  return (
    <InvoiceDetailView
      invoiceId={invoiceId}
      canManage={canAccessPath(user.role, user.pageAccess, "/renewal-retention/invoices/manage")}
      canApprove={canAccessPath(user.role, user.pageAccess, "/renewal-retention/plans/approve-override")}
    />
  )
}
