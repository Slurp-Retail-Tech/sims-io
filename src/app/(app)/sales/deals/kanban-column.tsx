"use client"

import { useDroppable } from "@dnd-kit/core"

import { cn } from "@/lib/utils"
import { formatCurrency } from "@/lib/currency"
import type { DealStage, MappedGlobalDeal } from "@/lib/deals"
import { DealCard } from "./deal-card"

export function KanbanColumn({
  stage,
  deals,
}: {
  stage: DealStage
  deals: MappedGlobalDeal[]
}) {
  const { setNodeRef, isOver } = useDroppable({ id: stage })
  const total = deals.reduce((sum, deal) => sum + (deal.amount ?? 0), 0)

  return (
    <div className="flex w-72 shrink-0 flex-col">
      <div className="mb-2 px-1">
        <div className="text-sm font-semibold">{stage}</div>
        <div className="text-muted-foreground text-xs">
          {deals.length} {deals.length === 1 ? "deal" : "deals"} · {formatCurrency(total)}
        </div>
      </div>
      <div
        ref={setNodeRef}
        className={cn(
          "flex min-h-32 flex-1 flex-col gap-2 rounded-lg border border-dashed p-2 transition-colors",
          isOver ? "border-primary bg-primary/5" : "border-border bg-muted/20"
        )}
      >
        {deals.length ? (
          deals.map((deal) => <DealCard key={deal.id} deal={deal} />)
        ) : (
          <div className="text-muted-foreground flex h-full items-center justify-center py-6 text-xs">
            Drop here
          </div>
        )}
      </div>
    </div>
  )
}
