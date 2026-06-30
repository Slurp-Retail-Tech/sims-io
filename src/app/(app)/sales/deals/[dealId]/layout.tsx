import type { Metadata } from "next"

export async function generateMetadata({
  params,
}: {
  params: Promise<{ dealId: string }>
}): Promise<Metadata> {
  const { dealId } = await params
  return { title: `Deal #${dealId}` }
}

export default function DealDetailLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return children
}
