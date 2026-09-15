"use client"

import * as React from "react"
import { AlertCircle } from "lucide-react"

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

import { minorToInput } from "./format"
import { LICENSE_PLANS, LICENSE_PLAN_LABELS } from "./types"
import type { FieldError, Plan } from "./types"

type PlanDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Null when creating. */
  plan: Plan | null
  onSaved: () => void
}

type FormState = {
  planCode: string
  planName: string
  licensePlan: string
  priceAnnually: string
  priceBiAnnually: string
  description: string
  isActive: boolean
}

function emptyForm(): FormState {
  return {
    planCode: "",
    planName: "",
    licensePlan: "essential",
    priceAnnually: "",
    priceBiAnnually: "",
    description: "",
    isActive: true,
  }
}

function formFromPlan(plan: Plan): FormState {
  return {
    planCode: plan.planCode,
    planName: plan.planName,
    licensePlan: plan.licensePlan,
    priceAnnually: minorToInput(plan.priceAnnuallyMinor),
    priceBiAnnually: minorToInput(plan.priceBiAnnuallyMinor),
    description: plan.description ?? "",
    isActive: plan.isActive,
  }
}

/**
 * Create or edit a plan.
 *
 * Leaving a term's price empty is deliberate and supported: the renewal page
 * then offers only the term that has a price. The form says so rather than
 * treating a blank as an error, because a plan sold only annually is normal.
 */
export function PlanDialog({
  open,
  onOpenChange,
  plan,
  onSaved,
}: PlanDialogProps) {
  const [form, setForm] = React.useState<FormState>(emptyForm)
  const [errors, setErrors] = React.useState<FieldError[]>([])
  const [generalError, setGeneralError] = React.useState<string | null>(null)
  const [saving, setSaving] = React.useState(false)

  // Reset whenever the dialog opens, so a cancelled edit never leaks into the
  // next one.
  React.useEffect(() => {
    if (open) {
      setForm(plan ? formFromPlan(plan) : emptyForm())
      setErrors([])
      setGeneralError(null)
    }
  }, [open, plan])

  const errorFor = (field: string) =>
    errors.find((error) => error.field === field)?.message ?? null

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    setSaving(true)
    setErrors([])
    setGeneralError(null)

    try {
      const response = await fetch(
        plan ? `/api/renewals/plans/${plan.id}` : "/api/renewals/plans",
        {
          method: plan ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            planCode: form.planCode,
            planName: form.planName,
            licensePlan: form.licensePlan,
            priceAnnually: form.priceAnnually,
            priceBiAnnually: form.priceBiAnnually,
            description: form.description,
            isActive: form.isActive,
          }),
        }
      )

      const payload = (await response.json().catch(() => null)) as {
        error?: string
        errors?: FieldError[]
      } | null

      if (!response.ok) {
        setErrors(payload?.errors ?? [])
        setGeneralError(
          payload?.errors?.length ? null : payload?.error ?? "Unable to save the plan."
        )
        return
      }

      onSaved()
      onOpenChange(false)
    } catch {
      setGeneralError("Unable to reach the server. Try again.")
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>{plan ? "Edit plan" : "New plan"}</DialogTitle>
            <DialogDescription>
              A plan is priced once and assigned to any number of outlets or
              franchises.
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

            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label htmlFor="planCode">Plan code</Label>
                <Input
                  id="planCode"
                  value={form.planCode}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      planCode: event.target.value,
                    }))
                  }
                  placeholder="ESS-STD"
                  aria-invalid={Boolean(errorFor("planCode"))}
                />
                {errorFor("planCode") ? (
                  <p className="text-destructive text-xs">{errorFor("planCode")}</p>
                ) : null}
              </div>

              <div className="grid gap-2">
                <Label htmlFor="licensePlan">Licence tier</Label>
                <Select
                  value={form.licensePlan}
                  onValueChange={(value) =>
                    setForm((current) => ({ ...current, licensePlan: value }))
                  }
                >
                  <SelectTrigger id="licensePlan">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {LICENSE_PLANS.map((tier) => (
                      <SelectItem key={tier} value={tier}>
                        {LICENSE_PLAN_LABELS[tier]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="planName">Plan name</Label>
              <Input
                id="planName"
                value={form.planName}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    planName: event.target.value,
                  }))
                }
                placeholder="Essential Standard"
                aria-invalid={Boolean(errorFor("planName"))}
              />
              {errorFor("planName") ? (
                <p className="text-destructive text-xs">{errorFor("planName")}</p>
              ) : null}
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label htmlFor="priceAnnually">1 year (RM)</Label>
                <Input
                  id="priceAnnually"
                  inputMode="decimal"
                  value={form.priceAnnually}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      priceAnnually: event.target.value,
                    }))
                  }
                  placeholder="1200.00"
                  aria-invalid={Boolean(errorFor("priceAnnually"))}
                />
                {errorFor("priceAnnually") ? (
                  <p className="text-destructive text-xs">
                    {errorFor("priceAnnually")}
                  </p>
                ) : null}
              </div>

              <div className="grid gap-2">
                <Label htmlFor="priceBiAnnually">6 months (RM)</Label>
                <Input
                  id="priceBiAnnually"
                  inputMode="decimal"
                  value={form.priceBiAnnually}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      priceBiAnnually: event.target.value,
                    }))
                  }
                  placeholder="700.00"
                  aria-invalid={Boolean(errorFor("priceBiAnnually"))}
                />
                {errorFor("priceBiAnnually") ? (
                  <p className="text-destructive text-xs">
                    {errorFor("priceBiAnnually")}
                  </p>
                ) : null}
              </div>
            </div>

            <p className="text-muted-foreground text-xs">
              Leave a term blank to stop offering it. Merchants on this plan then
              only see the term that has a price.
            </p>

            <div className="grid gap-2">
              <Label htmlFor="description">Description</Label>
              <Textarea
                id="description"
                value={form.description}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    description: event.target.value,
                  }))
                }
                rows={2}
              />
            </div>

            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="size-4"
                checked={form.isActive}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    isActive: event.target.checked,
                  }))
                }
              />
              Available for new assignments
            </label>
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
            <Button type="submit" disabled={saving}>
              {saving ? "Saving…" : plan ? "Save plan" : "Create plan"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
