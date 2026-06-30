"use client"

import * as React from "react"
import { LayoutGrid, List } from "lucide-react"

import { useToast } from "@/components/toast-provider"
import { Button } from "@/components/ui/button"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  isTerminalStage,
  type CloseLostReason,
  type DealStage,
  type MappedGlobalDeal,
} from "@/lib/deals"
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

export function DealsPageClient() {
  const { showToast } = useToast()
  const [deals, setDeals] = React.useState<MappedGlobalDeal[]>([])
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [view, setView] = React.useState<DealsView>(() => readDealsViewCookie())
  const [prompt, setPrompt] = React.useState<StagePrompt | null>(null)
  const [deleteTarget, setDeleteTarget] = React.useState<MappedGlobalDeal | null>(null)
  const [deletingDealId, setDeletingDealId] = React.useState<string | null>(null)

  const load = React.useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const response = await fetch("/api/deals")
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
  }, [])

  React.useEffect(() => {
    void load()
  }, [load])

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
