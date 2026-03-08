import type { Metadata } from "next"

import LeadsTable from "./leads-table"

export const metadata: Metadata = {
  title: "Sales Leads",
}

export default function SalesLeadsPage() {
  return <LeadsTable />
}
