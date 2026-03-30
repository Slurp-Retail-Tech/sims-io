import type { Metadata } from "next"

export const metadata: Metadata = {
  title: "Merchant Coverage Map",
}

export default function MapsLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return children
}
