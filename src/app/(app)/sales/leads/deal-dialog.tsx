"use client"

import * as React from "react"

import { useToast } from "@/components/toast-provider"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { DateTimePicker } from "@/components/ui/date-time-picker"
import { Field, FieldError, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  CLOSE_LOST_REASONS,
  DEAL_STAGES,
  TERMINAL_STAGES,
  type DealStage,
  type MappedDeal,
} from "@/lib/deals"

const isTerminal = (stage: DealStage) =>
  (TERMINAL_STAGES as readonly string[]).includes(stage)

type DealDialogProps = {
  leadId: string
  deal: MappedDeal | null
  open: boolean
  onClose: () => void
  onSaved: (deal: MappedDeal) => void
}

export function DealDialog({ leadId, deal, open, onClose, onSaved }: DealDialogProps) {
  const { showToast } = useToast()
  const [dealName, setDealName] = React.useState("")
  const [stage, setStage] = React.useState<DealStage>("To Qualify")
  const [amount, setAmount] = React.useState("")
  const [closedDate, setClosedDate] = React.useState("")
  const [closeLostReason, setCloseLostReason] = React.useState("")
  const [errors, setErrors] = React.useState<Record<string, string>>({})
  const [submitting, setSubmitting] = React.useState(false)

  // Reset form whenever the dialog opens for a new/edited deal.
  React.useEffect(() => {
    if (!open) {
      return
    }
    setDealName(deal?.dealName ?? "")
    setStage(deal?.dealStage ?? "To Qualify")
    setAmount(deal ? String(deal.amount) : "")
    setClosedDate(deal?.closedDate ?? "")
    setCloseLostReason(deal?.closeLostReason ?? "")
    setErrors({})
  }, [open, deal])

  const terminal = isTerminal(stage)
  const showCloseLostReason = stage === "Closed Lost"

  const handleStageChange = (next: DealStage) => {
    setStage(next)
    // Clear hidden/disabled fields so stale values aren't submitted.
    if (!isTerminal(next)) {
      setClosedDate("")
    }
    if (next !== "Closed Lost") {
      setCloseLostReason("")
    }
  }

  const handleSubmit = async () => {
    const nextErrors: Record<string, string> = {}
    if (!dealName.trim()) {
      nextErrors.dealName = "Deal name is required."
    }
    const amountValue = Number(amount)
    if (!amount.trim() || !Number.isFinite(amountValue) || amountValue < 0) {
      nextErrors.amount = "Enter a valid non-negative amount."
    }
    if (terminal && !closedDate) {
      nextErrors.closedDate = "Closed date is required."
    }
    if (showCloseLostReason && !closeLostReason) {
      nextErrors.closeLostReason = "Close lost reason is required."
    }
    setErrors(nextErrors)
    if (Object.keys(nextErrors).length > 0) {
      return
    }

    setSubmitting(true)
    try {
      const url = deal
        ? `/api/leads/${leadId}/deals/${deal.id}`
        : `/api/leads/${leadId}/deals`
      const method = deal ? "PATCH" : "POST"
      const response = await fetch(url, {
        method,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          dealName: dealName.trim(),
          dealStage: stage,
          amount: amountValue,
          closedDate: terminal && closedDate ? closedDate : null,
          closeLostReason: showCloseLostReason ? closeLostReason : null,
        }),
      })
      const data = (await response.json()) as { deal?: MappedDeal; error?: string }
      if (!response.ok || !data.deal) {
        throw new Error(data.error || "Unable to save deal.")
      }
      onSaved(data.deal)
      showToast(deal ? "Deal updated." : "Deal added.")
      onClose()
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Unable to save deal.", "error")
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => (!next ? onClose() : undefined)}>
      <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{deal ? "Edit deal" : "Add deal"}</DialogTitle>
          <DialogDescription>
            Track the package under negotiation and its current stage.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-5">
          <Field>
            <FieldLabel htmlFor="deal-name">Deal name</FieldLabel>
            <Input
              id="deal-name"
              value={dealName}
              onChange={(event) => setDealName(event.target.value)}
            />
            <FieldError errors={errors.dealName ? [{ message: errors.dealName }] : undefined} />
          </Field>

          <Field>
            <FieldLabel>Deal stage</FieldLabel>
            <Select value={stage} onValueChange={(value) => handleStageChange(value as DealStage)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {DEAL_STAGES.map((option) => (
                  <SelectItem key={option} value={option}>
                    {option}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          <Field>
            <FieldLabel htmlFor="deal-amount">Amount (MYR)</FieldLabel>
            <Input
              id="deal-amount"
              type="number"
              min="0"
              step="0.01"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
            />
            <FieldError errors={errors.amount ? [{ message: errors.amount }] : undefined} />
          </Field>

          {terminal ? (
            <Field>
              <FieldLabel htmlFor="deal-closed-date">Closed date</FieldLabel>
              <DateTimePicker
                id="deal-closed-date"
                mode="date"
                value={closedDate ? closedDate.slice(0, 10) : ""}
                onChange={setClosedDate}
                placeholder="Select closed date"
              />
              <FieldError errors={errors.closedDate ? [{ message: errors.closedDate }] : undefined} />
            </Field>
          ) : null}

          {showCloseLostReason ? (
            <Field>
              <FieldLabel>Close lost reason</FieldLabel>
              <Select value={closeLostReason} onValueChange={setCloseLostReason}>
                <SelectTrigger>
                  <SelectValue placeholder="Select a reason" />
                </SelectTrigger>
                <SelectContent>
                  {CLOSE_LOST_REASONS.map((option) => (
                    <SelectItem key={option} value={option}>
                      {option}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FieldError
                errors={errors.closeLostReason ? [{ message: errors.closeLostReason }] : undefined}
              />
            </Field>
          ) : null}
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button type="button" onClick={() => void handleSubmit()} disabled={submitting}>
            {submitting ? "Saving..." : deal ? "Save deal" : "Add deal"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
