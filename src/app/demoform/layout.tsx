import type { Metadata } from "next"

export const metadata: Metadata = {
  title: "Free Demo",
  description: "Send a message to Slurp via WhatsApp to book a demo.",
}

export default function DemoFormLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return children
}
