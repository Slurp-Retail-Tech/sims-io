import type { Metadata } from "next"

export const metadata: Metadata = {
  title: "Sales Appointment",
}

export default function SalesAppointmentsLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return children
}
