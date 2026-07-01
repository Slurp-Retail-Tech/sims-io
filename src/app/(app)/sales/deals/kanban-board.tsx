"use client"

import * as React from "react"
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core"

import { formatCurrency } from "@/lib/currency"
import {
  DEAL_STAGES,
  isDealStage,
  type DealStage,
  type MappedGlobalDeal,
} from "@/lib/deals"
import { KanbanColumn } from "./kanban-column"

type KanbanBoardProps = {
  deals: MappedGlobalDeal[]
  onStageChange: (deal: MappedGlobalDeal, target: DealStage) => void
}

export function KanbanBoard({ deals, onStageChange }: KanbanBoardProps) {
  const [activeId, setActiveId] = React.useState<string | null>(null)

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 180, tolerance: 8 } })
  )

  const dealsByStage = React.useMemo(() => {
    const map = new Map<DealStage, MappedGlobalDeal[]>()
    for (const stage of DEAL_STAGES) {
      map.set(stage, [])
    }
    for (const deal of deals) {
      map.get(deal.dealStage)?.push(deal)
    }
    return map
  }, [deals])

  const activeDeal = activeId ? deals.find((deal) => deal.id === activeId) ?? null : null

  const handleDragStart = (event: DragStartEvent) => {
    setActiveId(String(event.active.id))
  }

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event
    setActiveId(null)
    if (!over) {
      return
    }
    const targetStage = String(over.id)
    if (!isDealStage(targetStage)) {
      return
    }
    const deal = deals.find((item) => item.id === String(active.id))
    if (!deal || deal.dealStage === targetStage) {
      return
    }
    onStageChange(deal, targetStage)
  }

  return (
    <DndContext
      sensors={sensors}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragCancel={() => setActiveId(null)}
    >
      <div className="flex gap-4 overflow-x-auto pb-4">
        {DEAL_STAGES.map((stage) => (
          <KanbanColumn key={stage} stage={stage} deals={dealsByStage.get(stage) ?? []} />
        ))}
      </div>
      <DragOverlay>
        {activeDeal ? (
          <div className="w-72 rounded-lg border bg-card p-3 text-sm shadow-lg">
            <div className="truncate font-medium">{activeDeal.dealName}</div>
            <div className="text-muted-foreground mt-1 truncate text-xs">
              {activeDeal.leadName}
            </div>
            <div className="mt-2 font-semibold">{formatCurrency(activeDeal.amount)}</div>
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  )
}
