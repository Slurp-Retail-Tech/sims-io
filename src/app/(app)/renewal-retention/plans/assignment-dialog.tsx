"use client"

import * as React from "react"
import { AlertCircle, Building2, Store } from "lucide-react"

import { Button } from "@/components/ui/button"
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { cn } from "@/lib/utils"

import { formatMinor } from "./format"
import { TERM_LABELS } from "./types"
import type { AssignmentScope, BillingTerm, FieldError, Plan } from "./types"

type AssignmentDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Active plans only; a retired plan cannot take new assignments. */
  plans: Plan[]
  /** Pre-selected plan, when opened from a plan's own row. */
  initialPlanId?: string | null
  onSaved: (result: AssignmentSaved) => void
}

export type AssignmentSaved = {
  approvalStatus: "not_required" | "pending"
  supersededAssignmentId: string | null
}

type ResolvedFranchise = {
  /** The key subscriptions and the renewal cycle are grouped by. */
  externalId: string
  name: string
}

type OutletOption = {
  externalId: string
  name: string
}

type FormState = {
  planId: string
  scope: AssignmentScope
  franchiseInput: string
  outletId: string
  defaultBillingPlan: BillingTerm
  overridePriceAnnually: string
  overridePriceBiAnnually: string
  overrideReason: string
}

function emptyForm(): FormState {
  return {
    planId: "",
    scope: "franchise",
    franchiseInput: "",
    outletId: "",
    defaultBillingPlan: "annually",
    overridePriceAnnually: "",
    overridePriceBiAnnually: "",
    overrideReason: "",
  }
}

/**
 * Put a plan on a franchise or on one outlet.
 *
 * The agent types the franchise id they know and SIMS resolves the merchant
 * name back for confirmation, matching the Contacts mapping dialog. What gets
 * submitted is the merchant's `external_id`, not the typed text: that is the
 * key `outlet_subscriptions` carries and the key the nightly cycle groups by,
 * so an assignment stored under anything else would never be found.
 *
 * Franchise scope is the default because it is the ordinary case. An outlet
 * imported later inherits the franchise plan with no further step, whereas an
 * outlet-scope assignment covers exactly one outlet forever.
 */
export function AssignmentDialog({
  open,
  onOpenChange,
  plans,
  initialPlanId = null,
  onSaved,
}: AssignmentDialogProps) {
  const [form, setForm] = React.useState<FormState>(emptyForm)
  const [franchise, setFranchise] = React.useState<ResolvedFranchise | null>(null)
  const [outlets, setOutlets] = React.useState<OutletOption[] | null>(null)
  const [resolving, setResolving] = React.useState(false)
  const [errors, setErrors] = React.useState<FieldError[]>([])
  const [generalError, setGeneralError] = React.useState<string | null>(null)
  const [saving, setSaving] = React.useState(false)

  React.useEffect(() => {
    if (open) {
      setForm({ ...emptyForm(), planId: initialPlanId ?? "" })
      setFranchise(null)
      setOutlets(null)
      setErrors([])
      setGeneralError(null)
    }
  }, [open, initialPlanId])

  // Resolve the franchise and load its outlets together, debounced, with the
  // in-flight requests aborted so a fast typist cannot race an older response
  // into the field.
  React.useEffect(() => {
    const typed = form.franchiseInput.trim()
    if (!typed) {
      setFranchise(null)
      setOutlets(null)
      return
    }

    // Marked as resolving from the first keystroke, not from when the debounced
    // request leaves, so the field never reads "not found" while it is merely
    // waiting for the typist to pause.
    setResolving(true)
    const controller = new AbortController()
    const handle = setTimeout(async () => {
      try {
        const [lookupResponse, outletsResponse] = await Promise.all([
          fetch(`/api/merchants/lookup?fid=${encodeURIComponent(typed)}`, {
            signal: controller.signal,
          }),
          fetch(`/api/merchants/${encodeURIComponent(typed)}/outlets`, {
            signal: controller.signal,
          }),
        ])

        if (!lookupResponse.ok) {
          setFranchise(null)
          setOutlets(null)
          return
        }

        const lookup = (await lookupResponse.json()) as {
          merchant?: { externalId?: string; name?: string }
        }
        if (!lookup.merchant?.externalId) {
          setFranchise(null)
          setOutlets(null)
          return
        }
        setFranchise({
          externalId: lookup.merchant.externalId,
          name: lookup.merchant.name ?? lookup.merchant.externalId,
        })

        if (!outletsResponse.ok) {
          setOutlets([])
          return
        }
        const payload = (await outletsResponse.json()) as {
          outlets?: Array<{ external_id: string; name: string }>
        }
        setOutlets(
          (payload.outlets ?? []).map((outlet) => ({
            externalId: outlet.external_id,
            name: outlet.name,
          }))
        )
      } catch (error) {
        if ((error as Error).name !== "AbortError") {
          setFranchise(null)
          setOutlets(null)
        }
      } finally {
        setResolving(false)
      }
    }, 300)

    return () => {
      controller.abort()
      clearTimeout(handle)
    }
  }, [form.franchiseInput])

  // An outlet chosen against the previous franchise means nothing once the id
  // changes, and would otherwise be submitted as-is.
  React.useEffect(() => {
    setForm((current) =>
      current.outletId ? { ...current, outletId: "" } : current
    )
  }, [form.franchiseInput])

  const selectedPlan = plans.find((plan) => plan.id === form.planId) ?? null

  const errorFor = (field: string) =>
    errors.find((error) => error.field === field)?.message ?? null

  const hasOverride =
    form.overridePriceAnnually.trim() !== "" ||
    form.overridePriceBiAnnually.trim() !== ""

  const canSubmit =
    !saving &&
    Boolean(form.planId) &&
    franchise !== null &&
    (form.scope === "franchise" || Boolean(form.outletId))

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    if (!canSubmit || !franchise) {
      return
    }
    setSaving(true)
    setErrors([])
    setGeneralError(null)

    try {
      const response = await fetch("/api/renewals/plans/assignments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          planId: form.planId,
          scope: form.scope,
          franchiseId: franchise.externalId,
          outletId: form.scope === "outlet" ? form.outletId : null,
          defaultBillingPlan: form.defaultBillingPlan,
          overridePriceAnnually: form.overridePriceAnnually,
          overridePriceBiAnnually: form.overridePriceBiAnnually,
          overrideReason: form.overrideReason,
        }),
      })

      const payload = (await response.json().catch(() => null)) as
        | (AssignmentSaved & { error?: string; errors?: FieldError[] })
        | null

      if (!response.ok || !payload) {
        setErrors(payload?.errors ?? [])
        setGeneralError(
          payload?.errors?.length
            ? null
            : payload?.error ?? "Unable to save the assignment."
        )
        return
      }

      onSaved({
        approvalStatus: payload.approvalStatus,
        supersededAssignmentId: payload.supersededAssignmentId,
      })
      onOpenChange(false)
    } catch {
      setGeneralError("Unable to reach the server. Try again.")
    } finally {
      setSaving(false)
    }
  }

  const franchiseHint = !form.franchiseInput.trim()
    ? "Type the merchant's franchise id; SIMS resolves the name for confirmation."
    : resolving
      ? "Resolving…"
      : franchise
        ? `Resolves to ${franchise.name}`
        : "No franchise found for this id."

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Assign plan</DialogTitle>
            <DialogDescription>
              Put a plan on an entire franchise, or on one of its outlets.
              Assigning again at the same scope replaces what was there.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-4">
            {generalError ? (
              <p
                role="alert"
                className="text-destructive flex items-center gap-2 text-sm"
              >
                <AlertCircle className="size-4 shrink-0" />
                {generalError}
              </p>
            ) : null}

            <div className="grid gap-2">
              <Label htmlFor="assignPlan">Plan</Label>
              <Select
                value={form.planId}
                onValueChange={(value) =>
                  setForm((current) => ({ ...current, planId: value }))
                }
              >
                <SelectTrigger
                  id="assignPlan"
                  className="w-full"
                  aria-invalid={Boolean(errorFor("planId"))}
                >
                  <SelectValue
                    placeholder={
                      plans.length === 0
                        ? "No active plans to assign"
                        : "Select a plan"
                    }
                  />
                </SelectTrigger>
                <SelectContent>
                  {plans.map((plan) => (
                    <SelectItem key={plan.id} value={plan.id}>
                      {plan.planName}{" "}
                      <span className="text-muted-foreground font-mono text-xs">
                        {plan.planCode}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {selectedPlan ? (
                <p className="text-muted-foreground text-xs">
                  Catalog price: 1 year{" "}
                  {formatMinor(selectedPlan.priceAnnuallyMinor, selectedPlan.currencyCode)}
                  , 6 months{" "}
                  {formatMinor(
                    selectedPlan.priceBiAnnuallyMinor,
                    selectedPlan.currencyCode
                  )}
                </p>
              ) : errorFor("planId") ? (
                <p className="text-destructive text-xs">{errorFor("planId")}</p>
              ) : null}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <ScopeOption
                active={form.scope === "franchise"}
                icon={<Building2 className="size-4" />}
                title="Entire franchise"
                subtitle="Every outlet, now and in future"
                onSelect={() =>
                  setForm((current) => ({ ...current, scope: "franchise" }))
                }
              />
              <ScopeOption
                active={form.scope === "outlet"}
                icon={<Store className="size-4" />}
                title="One outlet"
                subtitle="Overrides the franchise plan"
                onSelect={() =>
                  setForm((current) => ({ ...current, scope: "outlet" }))
                }
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="assignFranchise">Franchise id</Label>
              <Input
                id="assignFranchise"
                value={form.franchiseInput}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    franchiseInput: event.target.value,
                  }))
                }
                placeholder="e.g. 11007"
                aria-invalid={Boolean(errorFor("franchiseId"))}
              />
              <p
                className={cn(
                  "text-xs",
                  form.franchiseInput.trim() && !resolving && !franchise
                    ? "text-destructive"
                    : "text-muted-foreground"
                )}
              >
                {errorFor("franchiseId") ?? franchiseHint}
              </p>
            </div>

            {form.scope === "outlet" ? (
              <div className="grid gap-2">
                <Label htmlFor="assignOutlet">Outlet</Label>
                <Select
                  value={form.outletId}
                  onValueChange={(value) =>
                    setForm((current) => ({ ...current, outletId: value }))
                  }
                  disabled={!franchise || !outlets?.length}
                >
                  <SelectTrigger id="assignOutlet" className="w-full">
                    <SelectValue
                      placeholder={
                        !form.franchiseInput.trim()
                          ? "Enter a franchise id first"
                          : resolving
                            ? "Loading outlets…"
                            : !franchise
                              ? "Franchise not found"
                              : outlets?.length
                                ? "Select an outlet"
                                : "This franchise has no outlets"
                      }
                    />
                  </SelectTrigger>
                  <SelectContent>
                    {(outlets ?? []).map((outlet) => (
                      <SelectItem key={outlet.externalId} value={outlet.externalId}>
                        {outlet.name} · {outlet.externalId}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {errorFor("outletId") ? (
                  <p className="text-destructive text-xs">{errorFor("outletId")}</p>
                ) : null}
              </div>
            ) : null}

            <div className="grid gap-2">
              <Label htmlFor="assignTerm">Default term</Label>
              <Select
                value={form.defaultBillingPlan}
                onValueChange={(value) =>
                  setForm((current) => ({
                    ...current,
                    defaultBillingPlan: value as BillingTerm,
                  }))
                }
              >
                <SelectTrigger id="assignTerm" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(TERM_LABELS) as BillingTerm[]).map((term) => (
                    <SelectItem key={term} value={term}>
                      {TERM_LABELS[term]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-muted-foreground text-xs">
                The term the proforma opens on. The merchant can still switch.
              </p>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label htmlFor="overrideAnnually">Agreed price, 1 year (RM)</Label>
                <Input
                  id="overrideAnnually"
                  inputMode="decimal"
                  value={form.overridePriceAnnually}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      overridePriceAnnually: event.target.value,
                    }))
                  }
                  placeholder="Catalog price"
                  aria-invalid={Boolean(errorFor("overridePriceAnnually"))}
                />
                {errorFor("overridePriceAnnually") ? (
                  <p className="text-destructive text-xs">
                    {errorFor("overridePriceAnnually")}
                  </p>
                ) : null}
              </div>
              <div className="grid gap-2">
                <Label htmlFor="overrideBiAnnually">Agreed price, 6 months (RM)</Label>
                <Input
                  id="overrideBiAnnually"
                  inputMode="decimal"
                  value={form.overridePriceBiAnnually}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      overridePriceBiAnnually: event.target.value,
                    }))
                  }
                  placeholder="Catalog price"
                  aria-invalid={Boolean(errorFor("overridePriceBiAnnually"))}
                />
                {errorFor("overridePriceBiAnnually") ? (
                  <p className="text-destructive text-xs">
                    {errorFor("overridePriceBiAnnually")}
                  </p>
                ) : null}
              </div>
            </div>

            {hasOverride ? (
              <div className="grid gap-2">
                <Label htmlFor="overrideReason">Why this price</Label>
                <Textarea
                  id="overrideReason"
                  value={form.overrideReason}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      overrideReason: event.target.value,
                    }))
                  }
                  rows={2}
                  aria-invalid={Boolean(errorFor("overrideReason"))}
                />
                <p
                  className={cn(
                    "text-xs",
                    errorFor("overrideReason")
                      ? "text-destructive"
                      : "text-muted-foreground"
                  )}
                >
                  {errorFor("overrideReason") ??
                    "Required. Applies every cycle until the assignment changes. A large change from the catalog price waits for approval before it prices anything."}
                </p>
              </div>
            ) : null}
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={saving}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={!canSubmit}>
              {saving ? "Assigning…" : "Assign plan"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function ScopeOption({
  active,
  icon,
  title,
  subtitle,
  onSelect,
}: {
  active: boolean
  icon: React.ReactNode
  title: string
  subtitle: string
  onSelect: () => void
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={active}
      className={cn(
        "flex flex-col gap-1 rounded-md border px-3 py-2.5 text-left transition-colors",
        active ? "border-primary bg-primary/5" : "hover:bg-accent/40 border-border"
      )}
    >
      <span className="flex items-center gap-2 text-sm font-medium">
        {icon}
        {title}
      </span>
      <span className="text-muted-foreground text-xs">{subtitle}</span>
    </button>
  )
}
