import { notFound } from "next/navigation"

import { requirePageAccess } from "@/lib/auth-server"
import { canAccessPath } from "@/lib/page-access"
import { getInvoiceById } from "@/lib/renewal/invoices"
import { loadRenewalSettings } from "@/lib/renewal/settings"

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
  // An unknown or malformed id is a 404 page, not an empty shell that fails
  // on its first fetch.
  if (!/^\d+$/.test(invoiceId)) {
    notFound()
  }
  const [invoice, settings] = await Promise.all([getInvoiceById(invoiceId), loadRenewalSettings()])
  if (!invoice) {
    notFound()
  }

  return (
    <InvoiceDetailView
      invoiceId={invoiceId}
      canManage={canAccessPath(user.role, user.pageAccess, "/renewal-retention/invoices/manage")}
      canApprove={canAccessPath(user.role, user.pageAccess, "/renewal-retention/plans/approve-override")}
      varianceThresholdPct={settings.overrideVarianceThresholdPct}
    />
  )
}
