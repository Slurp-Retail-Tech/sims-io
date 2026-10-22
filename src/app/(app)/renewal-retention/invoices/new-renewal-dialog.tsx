"use client"

import * as React from "react"
import { useRouter } from "next/navigation"

import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { useToast } from "@/components/toast-provider"
import { cn } from "@/lib/utils"

import { longDate, money, PillTabs, plural } from "../ui"

type Term = "annually" | "bi_annually"
type DocumentType = "proforma" | "quotation"

type FranchiseHit = { franchiseId: string; companyName: string | null; outletCount: number }

/** Mirrors `ManualFranchise` in `src/lib/renewal/manual-renewal-data.ts`. */
type ManualFranchise = {
  franchiseId: string
  companyName: string | null
  defaultDocument: DocumentType
  defaultTerm: Term
  outlets: Array<{
    outletId: string
    outletName: string | null
    validUntilDate: string | null
    blockReason: string | null
    planName: string | null
    prices: Partial<Record<Term, number>>
    openDocument: { id: string; invoiceNumber: string } | null
  }>
}

/**
 * Raise a proforma or quotation by hand: pick the franchise, tick outlets
 * sharing an expiry, choose the term and document, add a PO number. Priced
 * exactly as the nightly check would price it; outlets it would refuse are
 * shown with the reason and cannot be ticked.
 */
export function NewRenewalDialog({
  open,
  onOpenChange,
  initialFranchiseId,
  initialOutletId,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Start on this franchise, e.g. from a Renewal List row. */
  initialFranchiseId?: string | null
  initialOutletId?: string | null
}) {
  const router = useRouter()
  const { showToast } = useToast()
  const [query, setQuery] = React.useState("")
  const [hits, setHits] = React.useState<FranchiseHit[]>([])
  const [franchise, setFranchise] = React.useState<ManualFranchise | null>(null)
  const [loadingFranchise, setLoadingFranchise] = React.useState(false)
  const [selected, setSelected] = React.useState<Set<string>>(new Set())
  const [term, setTerm] = React.useState<Term>("annually")
  const [documentType, setDocumentType] = React.useState<DocumentType>("proforma")
  const [poNumber, setPoNumber] = React.useState("")
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  const pickFranchise = React.useCallback(async (franchiseId: string, outletId?: string | null) => {
    setLoadingFranchise(true)
    setError(null)
    try {
      const response = await fetch(`/api/renewals/invoices/new?franchiseId=${encodeURIComponent(franchiseId)}`, { cache: "no-store" })
      const payload = (await response.json().catch(() => ({}))) as { franchise?: ManualFranchise; error?: string }
      if (!response.ok || !payload.franchise) {
        setError(payload.error ?? "Unable to load the franchise.")
        return
      }
      const loaded = payload.franchise
      setFranchise(loaded)
      setTerm(loaded.defaultTerm)
      setDocumentType(loaded.defaultDocument)
      const preselect = loaded.outlets.find((outlet) => outlet.outletId === outletId && !outlet.blockReason && !outlet.openDocument)
      setSelected(new Set(preselect ? [preselect.outletId] : []))
    } catch {
      setError("Unable to reach the server. Try again.")
    } finally {
      setLoadingFranchise(false)
    }
  }, [])

  React.useEffect(() => {
    if (!open) return
    setQuery("")
    setHits([])
    setFranchise(null)
    setSelected(new Set())
    setPoNumber("")
    setError(null)
    if (initialFranchiseId) void pickFranchise(initialFranchiseId, initialOutletId)
  }, [open, initialFranchiseId, initialOutletId, pickFranchise])

  React.useEffect(() => {
    const search = query.trim()
    if (franchise || search.length < 2) {
      setHits([])
      return
    }
    const controller = new AbortController()
    const timer = window.setTimeout(async () => {
      try {
        const response = await fetch(`/api/renewals/invoices/new?q=${encodeURIComponent(search)}`, { signal: controller.signal })
        const payload = (await response.json().catch(() => ({}))) as { franchises?: FranchiseHit[] }
        setHits(payload.franchises ?? [])
      } catch {
        // Superseded by the next keystroke.
      }
    }, 250)
    return () => {
      controller.abort()
      window.clearTimeout(timer)
    }
  }, [query, franchise])

  const chosen = franchise?.outlets.filter((outlet) => selected.has(outlet.outletId)) ?? []
  // One document renews from one expiry; once an outlet is ticked, only its
  // expiry date's outlets stay selectable.
  const expiry = chosen[0]?.validUntilDate ?? null
  const total = chosen.reduce((sum, outlet) => sum + (outlet.prices[term] ?? 0), 0)
  const unpriced = chosen.filter((outlet) => outlet.prices[term] === undefined)

  function toggle(outletId: string, checked: boolean) {
    setSelected((current) => {
      const next = new Set(current)
      if (checked) next.add(outletId)
      else next.delete(outletId)
      return next
    })
  }

  async function create(issueNow: boolean) {
    if (!franchise) return
    setBusy(true)
    setError(null)
    try {
      const response = await fetch("/api/renewals/invoices", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          franchiseId: franchise.franchiseId,
          outletIds: [...selected],
          term,
          issuedAs: documentType,
          poNumber: poNumber.trim() || null,
          issueNow,
        }),
      })
      const payload = (await response.json().catch(() => ({}))) as {
        error?: string
        invoiceId?: string
        invoiceNumber?: string
        hasPic?: boolean
      }
      if (!response.ok || !payload.invoiceId) {
        setError(payload.error ?? "Unable to create the renewal document.")
        return
      }
      showToast(
        `${payload.invoiceNumber} created${issueNow ? " and issued" : " as a draft"}.${payload.hasPic ? "" : " No renewal PIC is set, so share the link yourself."}`,
        "success"
      )
      onOpenChange(false)
      router.push(`/renewal-retention/invoices/${payload.invoiceId}`)
    } catch {
      setError("Unable to reach the server. Try again.")
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>New renewal</DialogTitle>
          <DialogDescription>
            Raise a proforma or quotation now, outside the nightly check. It is priced from the outlet&rsquo;s plan, renews
            from its current expiry, and the nightly reminders pick it up like any other.
          </DialogDescription>
        </DialogHeader>

        {!franchise ? (
          <div className="grid gap-2 py-1">
            <Label htmlFor="nr-search" className="text-xs">
              Franchise
            </Label>
            <Input
              id="nr-search"
              autoFocus
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Company name, outlet name, FID or OID"
              className="h-9"
            />
            {loadingFranchise ? <p className="text-muted-foreground text-xs">Loading…</p> : null}
            <div className="grid gap-1">
              {hits.map((hit) => (
                <button
                  key={hit.franchiseId}
                  type="button"
                  onClick={() => void pickFranchise(hit.franchiseId)}
                  className="hover:bg-accent/40 flex items-center justify-between rounded-md border px-3 py-2 text-left text-sm"
                >
                  <span className="truncate">{hit.companyName ?? `Franchise ${hit.franchiseId}`}</span>
                  <span className="text-muted-foreground shrink-0 text-xs">
                    FID {hit.franchiseId} · {plural(hit.outletCount, "outlet")}
                  </span>
                </button>
              ))}
              {query.trim().length >= 2 && hits.length === 0 && !loadingFranchise ? (
                <p className="text-muted-foreground text-xs">No franchise in the renewal book matches.</p>
              ) : null}
            </div>
          </div>
        ) : (
          <div className="grid gap-4 py-1">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="truncate text-sm font-medium">{franchise.companyName ?? `Franchise ${franchise.franchiseId}`}</div>
                <div className="text-muted-foreground text-xs">FID {franchise.franchiseId}</div>
              </div>
              {!initialFranchiseId ? (
                <Button variant="ghost" size="sm" onClick={() => setFranchise(null)}>
                  Change
                </Button>
              ) : null}
            </div>

            <div className="grid gap-1.5">
              <div className="text-muted-foreground text-xs">Outlets</div>
              {franchise.outlets.map((outlet) => {
                const otherExpiry = expiry !== null && outlet.validUntilDate !== expiry
                const unavailable = outlet.blockReason ?? (outlet.openDocument ? `Already on ${outlet.openDocument.invoiceNumber}.` : null)
                const disabled = Boolean(unavailable) || (otherExpiry && !selected.has(outlet.outletId))
                return (
                  <label
                    key={outlet.outletId}
                    className={cn("flex items-start gap-3 rounded-md border px-3 py-2", disabled && "opacity-60")}
                  >
                    <Checkbox
                      className="mt-0.5"
                      checked={selected.has(outlet.outletId)}
                      disabled={disabled}
                      onCheckedChange={(checked) => toggle(outlet.outletId, checked === true)}
                    />
                    <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <span className="flex items-baseline justify-between gap-2 text-sm">
                        <span className="truncate">{outlet.outletName ?? `Outlet ${outlet.outletId}`}</span>
                        <span className="shrink-0 tabular-nums">
                          {outlet.prices[term] !== undefined ? money(outlet.prices[term]) : "—"}
                        </span>
                      </span>
                      <span className="text-muted-foreground text-xs">
                        OID {outlet.outletId} · expires {longDate(outlet.validUntilDate)}
                        {outlet.planName ? ` · ${outlet.planName}` : ""}
                      </span>
                      {unavailable ? (
                        <span className="text-xs text-amber-700 dark:text-amber-300">
                          {unavailable}
                          {outlet.openDocument ? (
                            <>
                              {" "}
                              <a className="underline" href={`/renewal-retention/invoices/${outlet.openDocument.id}`}>
                                Open it
                              </a>
                            </>
                          ) : null}
                        </span>
                      ) : otherExpiry && !selected.has(outlet.outletId) ? (
                        <span className="text-muted-foreground text-xs">Different expiry: raise a separate document.</span>
                      ) : null}
                    </span>
                  </label>
                )
              })}
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="grid gap-1.5">
                <div className="text-muted-foreground text-xs">Term</div>
                <PillTabs<Term>
                  size="sm"
                  value={term}
                  onChange={setTerm}
                  tabs={[
                    { key: "annually", label: "1 year" },
                    { key: "bi_annually", label: "6 months" },
                  ]}
                />
              </div>
              <div className="grid gap-1.5">
                <div className="text-muted-foreground text-xs">Document</div>
                <PillTabs<DocumentType>
                  size="sm"
                  value={documentType}
                  onChange={setDocumentType}
                  tabs={[
                    { key: "proforma", label: "Proforma" },
                    { key: "quotation", label: "Quotation" },
                  ]}
                />
              </div>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="nr-po" className="text-xs">
                PO number (optional)
              </Label>
              <Input id="nr-po" value={poNumber} onChange={(event) => setPoNumber(event.target.value)} maxLength={64} className="h-8" />
            </div>

            <div className="flex items-baseline justify-between border-t pt-3 text-sm">
              <span className="text-muted-foreground">
                {chosen.length === 0 ? "No outlets ticked" : `${plural(chosen.length, "outlet")}, before tax`}
              </span>
              <span className="font-semibold tabular-nums">{money(total)}</span>
            </div>
            {unpriced.length > 0 ? (
              <p className="text-xs text-amber-700 dark:text-amber-300">
                {unpriced.map((outlet) => outlet.outletName ?? outlet.outletId).join(", ")} has no price for this term.
              </p>
            ) : null}
          </div>
        )}

        {error ? <p className="text-destructive text-sm">{error}</p> : null}

        <DialogFooter>
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          {franchise ? (
            <>
              <Button variant="outline" size="sm" disabled={busy || chosen.length === 0 || unpriced.length > 0} onClick={() => void create(false)}>
                Create draft
              </Button>
              <Button size="sm" disabled={busy || chosen.length === 0 || unpriced.length > 0} onClick={() => void create(true)}>
                {busy ? "Creating…" : "Create and issue"}
              </Button>
            </>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
