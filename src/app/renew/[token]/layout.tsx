import type { Metadata } from "next"

import { resolveAppBaseUrl } from "@/lib/auth"

/**
 * Generic metadata for every renewal link.
 *
 * Deliberately identical for every token: WhatsApp and email clients fetch
 * the page to build a preview card, and a card naming the merchant or the
 * amount would leak billing detail into a chat preview for no gain. Reading
 * the page records an open only for non-staff visitors, and a crawler's
 * fetch of the HTML shell never reaches the JSON API that does that.
 */
export async function generateMetadata(): Promise<Metadata> {
  const baseUrl = resolveAppBaseUrl().replace(/\/+$/, "")
  return {
    title: "Renew your Slurp licence",
    description: "Review your renewal, choose a term, and pay securely online.",
    robots: { index: false, follow: false },
    openGraph: {
      type: "website",
      siteName: "Slurp!",
      title: "Your Slurp renewal",
      description: "Review your renewal, choose a term, and pay securely online.",
      images: [{ url: `${baseUrl}/system-logo-v2.png`, width: 1024, height: 1024, alt: "Slurp!" }],
    },
  }
}

export default function RenewLayout({ children }: { children: React.ReactNode }) {
  return children
}
