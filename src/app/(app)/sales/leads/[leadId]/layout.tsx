import type { Metadata } from "next"

export async function generateMetadata({
  params,
}: {
  params: Promise<{ leadId: string }>
}): Promise<Metadata> {
  const { leadId } = await params
  return { title: `Lead #${leadId}` }
}

export default function LeadDetailLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return children
}
