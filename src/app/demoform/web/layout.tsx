import type { Metadata } from "next"

export const metadata: Metadata = {
  title: "Book a Demo",
  description: "Fill in your details to book a Slurp demo and our team will be in touch.",
}

export default function DemoFormWebLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return children
}
