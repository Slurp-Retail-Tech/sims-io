import type { Metadata } from "next"

export const metadata: Metadata = {
  title: "Your Slurp renewal receipt",
  robots: { index: false, follow: false },
}

export default function ReceiptLayout({ children }: { children: React.ReactNode }) {
  return children
}
