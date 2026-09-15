import { requirePageAccess } from "@/lib/auth-server"

import { InvoiceDetailView } from "./invoice-detail-view"

export default async function InvoiceDetailPage({
  params,
}: {
  params: Promise<{ invoiceId: string }>
}) {
  await requirePageAccess([
    "/renewal-retention/invoices",
    "/renewal-retention/invoices/manage",
  ])

  const { invoiceId } = await params
  return <InvoiceDetailView invoiceId={invoiceId} />
}
