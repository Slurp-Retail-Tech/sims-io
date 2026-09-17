import type { Metadata } from "next"

import { requirePageAccess } from "@/lib/auth-server"

import { OverviewView } from "./overview-view"

export const metadata: Metadata = {
  title: "Renewal – Overview",
}

export default async function RenewalRetentionOverviewPage() {
  await requirePageAccess(["/renewal-retention/overview"])
  return <OverviewView />
}
