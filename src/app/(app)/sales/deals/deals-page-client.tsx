"use client"

import * as React from "react"
import { LayoutGrid, List } from "lucide-react"

import { getSessionUser } from "@/lib/session"
import { useToast } from "@/components/toast-provider"
import { Button } from "@/components/ui/button"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  isTerminalStage,
  type CloseLostReason,
  type DealStage,
  type MappedGlobalDeal,
} from "@/lib/deals"
import type { AssignableUser } from "../leads/types"
import { DealsTable } from "./deals-table"
import { KanbanBoard } from "./kanban-board"
import {
  StageChangePromptDialog,
  type StagePrompt,
} from "./stage-change-prompt-dialog"
import {
  readDealsViewCookie,
  writeDealsViewCookie,
  type DealsView,
} from "./view-state"

const ALL_VALUE = "__all__"
const UNASSIGNED_VALUE = "__unassigned__"

export function DealsPageClient() {
  const { showToast } = useToast()
  const sessionUser = React.useMemo(() => getSessionUser(), [])
  const isManager =
    sessionUser?.role === "Admin" || sessionUser?.role === "Super Admin"
  const [deals, setDeals] = React.useState<MappedGlobalDeal[]>([])
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [view, setView] = React.useState<DealsView>(() => readDealsViewCookie())
  const [prompt, setPrompt] = React.useState<StagePrompt | null>(null)
  const [deleteTarget, setDeleteTarget] = React.useState<MappedGlobalDeal | null>(null)
  const [deletingDealId, setDeletingDealId] = React.useState<string | null>(null)
  const [assignedFilter, setAssignedFilter] = React.useState<string>(ALL_VALUE)
  const [assignableUsers, setAssignableUsers] = React.useState<AssignableUser[]>([])

  const load = React.useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams()
      // Only managers can filter by assignee; the server ignores it otherwise.
      if (isManager && assignedFilter !== ALL_VALUE) {
        params.set(
          "assigned",
          assignedFilter === UNASSIGNED_VALUE ? "unassigned" : assignedFilter
        )
      }
      const query = params.toString()
      const response = await fetch(`/api/deals${query ? `?${query}` : ""}`)
      if (!response.ok) {
        throw new Error("Unable to load deals.")
      }
      const data = (await response.json()) as { deals: MappedGlobalDeal[] }
      setDeals(data.deals ?? [])
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load deals.")
    } finally {
      setLoading(false)
    }
  }, [isManager, assignedFilter])

  React.useEffect(() => {
    void load()
  }, [load])

  // Managers can filter by assignee; load the option list once.
  React.useEffect(() => {
    if (!isManager) {
      return
    }
    const loadUsers = async () => {
      try {
        const response = await fetch("/api/users/sales-agents")
        if (!response.ok) {
          return
        }
        const data = (await response.json()) as { users: AssignableUser[] }
        setAssignableUsers(data.users ?? [])
      } catch {
        // Filter degrades gracefully to "All" if options fail to load.
      }
    }
    void loadUsers()
  }, [isManager])

  const handleViewChange = (next: string) => {
    const value: DealsView = next === "list" ? "list" : "kanban"
    setView(value)
    writeDealsViewCookie(value)
  }

  const commitStageChange = React.useCallback(
    async (
      deal: MappedGlobalDeal,
      patch: {
        dealStage: DealStage
        closedDate?: string | null
        closeLostReason?: CloseLostReason | null
      }
    ) => {
      const previous = deals
      // Optimistic update.
      setDeals((current) =>
        current.map((item) =>
          item.id === deal.id
            ? {
                ...item,
                dealStage: patch.dealStage,
                closedDate: isTerminalStage(patch.dealStage)
                  ? patch.closedDate ?? item.closedDate
                  : null,
                closeLostReason:
                  patch.dealStage === "Closed Lost"
                    ? (patch.closeLostReason ?? item.closeLostReason)
                    : null,
              }
            : item
        )
      )
      try {
        const response = await fetch(`/api/deals/${deal.id}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(patch),
        })
        const data = (await response.json()) as { deal?: MappedGlobalDeal; error?: string }
        if (!response.ok || !data.deal) {
          throw new Error(data.error || "Unable to update deal.")
        }
        // Replace with server truth (locks in cleared fields).
        setDeals((current) =>
          current.map((item) => (item.id === deal.id ? data.deal! : item))
        )
      } catch (err) {
        setDeals(previous) // revert
        showToast(
          err instanceof Error ? err.message : "Couldn't update deal stage. Please try again.",
          "error"
        )
      }
    },
    [deals, showToast]
  )

  const handleStageChange = React.useCallback(
    (deal: MappedGlobalDeal, target: DealStage) => {
      if (target === deal.dealStage) {
        return
      }
      if (isTerminalStage(target)) {
        // Defer the move until the prompt is confirmed.
        setPrompt({
          dealId: deal.id,
          dealName: deal.dealName,
          targetStage: target as "Closed Won" | "Closed Lost",
          initialClosedDate: deal.closedDate,
        })
        return
      }
      void commitStageChange(deal, { dealStage: target })
    },
    [commitStageChange]
  )

  const handleDeleteDeal = React.useCallback(
    async (deal: MappedGlobalDeal) => {
      setDeletingDealId(deal.id)
      try {
        const response = await fetch(`/api/deals/${deal.id}`, { method: "DELETE" })
        if (!response.ok) {
          const data = (await response.json().catch(() => ({}))) as { error?: string }
          throw new Error(data.error || "Unable to delete deal.")
        }
        setDeals((current) => current.filter((item) => item.id !== deal.id))
        showToast("Deal deleted.")
      } catch (err) {
        showToast(
          err instanceof Error ? err.message : "Unable to delete deal.",
          "error"
        )
      } finally {
        setDeletingDealId(null)
        setDeleteTarget(null)
      }
    },
    [showToast]
  )

  const handlePromptConfirm = (input: {
    closedDate: string
    closeLostReason: string | null
  }) => {
    if (!prompt) {
      return
    }
    const deal = deals.find((item) => item.id === prompt.dealId)
    if (deal) {
      void commitStageChange(deal, {
        dealStage: prompt.targetStage,
        closedDate: input.closedDate,
        closeLostReason: input.closeLostReason as CloseLostReason | null,
      })
    }
    setPrompt(null)
  }

  return (
    <div className="animate-in fade-in slide-in-from-bottom-2 flex flex-col gap-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Deals</h1>
          <p className="text-muted-foreground text-sm">
            Track every deal across leads in one pipeline.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {isManager ? (
            <Select value={assignedFilter} onValueChange={setAssignedFilter}>
              <SelectTrigger className="h-9 w-[180px] text-xs">
                <SelectValue placeholder="Assigned user" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL_VALUE}>All assignees</SelectItem>
                <SelectItem value={UNASSIGNED_VALUE}>Unassigned</SelectItem>
                {assignableUsers.map((user) => (
                  <SelectItem key={user.id} value={user.id}>
                    {user.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : null}
          <Tabs value={view} onValueChange={handleViewChange}>
            <TabsList>
              <TabsTrigger value="kanban">
                <LayoutGrid className="mr-1.5 size-4" />
                Kanban
              </TabsTrigger>
              <TabsTrigger value="list">
                <List className="mr-1.5 size-4" />
                List
              </TabsTrigger>
            </TabsList>
          </Tabs>
        </div>
      </div>

      {loading ? (
        <div className="text-muted-foreground text-sm">Loading deals...</div>
      ) : error ? (
        <div className="flex flex-col gap-3">
          <div className="text-sm text-red-600">{error}</div>
          <div>
            <Button size="sm" variant="outline" onClick={() => void load()}>
              Retry
            </Button>
          </div>
        </div>
      ) : view === "kanban" ? (
        <KanbanBoard deals={deals} onStageChange={handleStageChange} />
      ) : (
        <DealsTable
          deals={deals}
          onDelete={setDeleteTarget}
          deletingDealId={deletingDealId}
        />
      )}

      <StageChangePromptDialog
        prompt={prompt}
        onConfirm={handlePromptConfirm}
        onCancel={() => setPrompt(null)}
      />

      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null)
        }}
        title="Delete deal"
        description={
          deleteTarget
            ? `Are you sure you want to delete "${deleteTarget.dealName}"? This cannot be undone.`
            : undefined
        }
        confirmLabel="Delete"
        destructive
        loading={deletingDealId !== null}
        onConfirm={() => {
          if (deleteTarget) {
            void handleDeleteDeal(deleteTarget)
          }
        }}
      />
    </div>
  )
}
