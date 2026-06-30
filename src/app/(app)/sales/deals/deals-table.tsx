"use client"

import Link from "next/link"

import { formatDate } from "@/lib/dates"
import { formatCurrency } from "@/lib/currency"
import { TERMINAL_STAGES, type MappedGlobalDeal } from "@/lib/deals"
import { Button } from "@/components/ui/button"

const isTerminal = (stage: string) =>
  (TERMINAL_STAGES as readonly string[]).includes(stage)

export function DealsTable({
  deals,
  onDelete,
  deletingDealId,
}: {
  deals: MappedGlobalDeal[]
  onDelete: (deal: MappedGlobalDeal) => void
  deletingDealId: string | null
}) {
  if (!deals.length) {
    return <div className="text-muted-foreground text-sm">No deals found.</div>
  }

  return (
    <div className="overflow-x-auto rounded-lg border bg-card">
      <table className="w-full text-sm">
        <thead className="bg-muted/50 text-left text-xs font-semibold text-muted-foreground">
          <tr>
            <th className="px-4 py-3">Deal</th>
            <th className="px-4 py-3">Lead</th>
            <th className="px-4 py-3">Stage</th>
            <th className="px-4 py-3">Amount</th>
            <th className="px-4 py-3">Closed date</th>
            <th className="px-4 py-3">Assigned user</th>
            <th className="px-4 py-3" />
          </tr>
        </thead>
        <tbody>
          {deals.map((deal, index) => (
            <tr key={deal.id} className={index % 2 === 0 ? "bg-background" : "bg-muted/20"}>
              <td className="px-4 py-3 font-medium">
                <Link href={`/sales/deals/${deal.id}`} className="hover:underline">
                  {deal.dealName}
                </Link>
              </td>
              <td className="px-4 py-3">
                <Link
                  href={`/sales/leads/${deal.leadId}`}
                  className="text-muted-foreground hover:underline"
                >
                  {deal.leadName}
                </Link>
              </td>
              <td className="px-4 py-3">{deal.dealStage}</td>
              <td className="px-4 py-3">{formatCurrency(deal.amount)}</td>
              <td className="px-4 py-3 text-muted-foreground">
                {isTerminal(deal.dealStage) && deal.closedDate
                  ? formatDate(deal.closedDate)
                  : "--"}
              </td>
              <td className="px-4 py-3 text-muted-foreground">
                {deal.assignedUserName ?? "Unassigned"}
              </td>
              <td className="px-4 py-3 text-right">
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-destructive hover:text-destructive"
                  disabled={deletingDealId === deal.id}
                  onClick={() => onDelete(deal)}
                >
                  {deletingDealId === deal.id ? "Deleting..." : "Delete"}
                </Button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
