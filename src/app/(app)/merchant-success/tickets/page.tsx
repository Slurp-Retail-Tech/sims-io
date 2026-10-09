import { cookies } from "next/headers"

import { dateFilterCookie } from "./date-filter-cookie"
import { MerchantSuccessTicketsPageClient } from "./tickets-page-client"

export default async function MerchantSuccessTicketsPage() {
  const cookieStore = await cookies()
  return (
    <MerchantSuccessTicketsPageClient
      initialDateFilter={cookieStore.get(dateFilterCookie)?.value ?? null}
    />
  )
}
