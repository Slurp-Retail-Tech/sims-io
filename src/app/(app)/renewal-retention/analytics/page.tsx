import type { Metadata } from "next"

import { requirePageAccess } from "@/lib/auth-server"

import { AnalyticsView } from "./analytics-view"

export const metadata: Metadata = {
  title: "Renewal – Analytics",
}

export default async function RenewalRetentionAnalyticsPage() {
  await requirePageAccess(["/renewal-retention/analytics"])
  return <AnalyticsView />
}
