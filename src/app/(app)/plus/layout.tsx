import type { Metadata } from "next"

export const metadata: Metadata = {
  title: "PLUS",
}

export default function PlusLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return children
}
