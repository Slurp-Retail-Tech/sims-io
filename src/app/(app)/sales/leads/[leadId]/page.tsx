import { LeadDetailView } from "./lead-detail-view"

export default async function LeadDetailPage({
  params,
}: {
  params: Promise<{ leadId: string }>
}) {
  const { leadId } = await params
  return <LeadDetailView leadId={leadId} />
}
