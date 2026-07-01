import { cn } from "@/lib/utils"
import type { LeadStatus } from "@/lib/leads"

const STATUS_BADGE_CLASS: Record<LeadStatus, string> = {
  Unworked: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
  Worked: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
}

export function LeadStatusBadge({ status }: { status: LeadStatus }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium",
        STATUS_BADGE_CLASS[status]
      )}
    >
      {status}
    </span>
  )
}
