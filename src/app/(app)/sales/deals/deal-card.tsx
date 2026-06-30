"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { useDraggable } from "@dnd-kit/core"

import { cn } from "@/lib/utils"
import { formatCurrency } from "@/lib/currency"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import type { MappedGlobalDeal } from "@/lib/deals"

export function DealCard({ deal }: { deal: MappedGlobalDeal }) {
  const router = useRouter()
  const { attributes, listeners, setNodeRef, transform, isDragging } =
    useDraggable({ id: deal.id, data: { deal } })

  const handleClick = () => {
    // useDraggable suppresses click after a real drag via the sensor activation
    // constraint, but guard anyway.
    if (isDragging) {
      return
    }
    router.push(`/sales/deals/${deal.id}`)
  }

  return (
    <div
      ref={setNodeRef}
      style={{
        transform: transform
          ? `translate3d(${transform.x}px, ${transform.y}px, 0)`
          : undefined,
      }}
      className={cn(
        "cursor-grab rounded-lg border bg-card p-3 text-sm shadow-sm transition-shadow active:cursor-grabbing",
        isDragging && "opacity-50"
      )}
      {...listeners}
      {...attributes}
      onClick={handleClick}
    >
      <Tooltip>
        <TooltipTrigger asChild>
          <div className="truncate font-medium">{deal.dealName}</div>
        </TooltipTrigger>
        <TooltipContent>{deal.dealName}</TooltipContent>
      </Tooltip>
      <div className="text-muted-foreground mt-1 truncate text-xs">{deal.leadName}</div>
      <div className="mt-2 flex items-center justify-between gap-2">
        <span className="font-semibold">{formatCurrency(deal.amount)}</span>
        <span className="text-muted-foreground truncate text-xs">
          {deal.assignedUserName ?? "Unassigned"}
        </span>
      </div>
    </div>
  )
}
