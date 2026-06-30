import { DealDetailView } from "./deal-detail-view"

export default async function DealDetailPage({
  params,
}: {
  params: Promise<{ dealId: string }>
}) {
  const { dealId } = await params
  return <DealDetailView dealId={dealId} />
}
