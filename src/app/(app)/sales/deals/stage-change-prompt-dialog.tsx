"use client"

import * as React from "react"

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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { CLOSE_LOST_REASONS } from "@/lib/deals"

export type StagePrompt = {
  dealId: string
  dealName: string
  targetStage: "Closed Won" | "Closed Lost"
  initialClosedDate: string | null
}

type StageChangePromptDialogProps = {
  prompt: StagePrompt | null
  onConfirm: (input: { closedDate: string; closeLostReason: string | null }) => void
  onCancel: () => void
}

export function StageChangePromptDialog({
  prompt,
  onConfirm,
  onCancel,
}: StageChangePromptDialogProps) {
  const [closedDate, setClosedDate] = React.useState("")
  const [closeLostReason, setCloseLostReason] = React.useState("")
  const [errors, setErrors] = React.useState<Record<string, string>>({})

  React.useEffect(() => {
    if (!prompt) {
      return
    }
    setClosedDate(prompt.initialClosedDate ? prompt.initialClosedDate.slice(0, 10) : "")
    setCloseLostReason("")
    setErrors({})
  }, [prompt])

  const isLost = prompt?.targetStage === "Closed Lost"

  const handleConfirm = () => {
    const nextErrors: Record<string, string> = {}
    if (!closedDate) {
      nextErrors.closedDate = "Closed date is required."
    }
    if (isLost && !closeLostReason) {
      nextErrors.closeLostReason = "Close lost reason is required."
    }
    setErrors(nextErrors)
    if (Object.keys(nextErrors).length > 0) {
      return
    }
    onConfirm({ closedDate, closeLostReason: isLost ? closeLostReason : null })
  }

  return (
    <Dialog
      open={Boolean(prompt)}
      onOpenChange={(open) => {
        if (!open) {
          onCancel()
        }
      }}
    >
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Move to {prompt?.targetStage}</DialogTitle>
          <DialogDescription>
            {prompt ? `Update "${prompt.dealName}" to ${prompt.targetStage}.` : null}
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-5">
          <Field>
            <FieldLabel htmlFor="prompt-closed-date">Closed date</FieldLabel>
            <DateTimePicker
              id="prompt-closed-date"
              mode="date"
              value={closedDate}
              onChange={setClosedDate}
              placeholder="Select closed date"
            />
            <FieldError errors={errors.closedDate ? [{ message: errors.closedDate }] : undefined} />
          </Field>
          {isLost ? (
            <Field>
              <FieldLabel>Close lost reason</FieldLabel>
              <Select value={closeLostReason} onValueChange={setCloseLostReason}>
                <SelectTrigger>
                  <SelectValue placeholder="Select a reason" />
                </SelectTrigger>
                <SelectContent>
                  {CLOSE_LOST_REASONS.map((reason) => (
                    <SelectItem key={reason} value={reason}>
                      {reason}
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
          <Button type="button" variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <Button type="button" onClick={handleConfirm}>
            Confirm
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
