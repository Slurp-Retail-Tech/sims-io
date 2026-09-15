import type { Metadata } from "next"

export const metadata: Metadata = {
  title: "Renewal – Plan Catalog",
}

export default function RenewalPlansLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return children
}
