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
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { useToast } from "@/components/toast-provider"
import { NON_RENEWAL_REASONS, validateNonRenewal } from "@/lib/renewal/non-renewal"
import type { NonRenewalReason } from "@/lib/renewal/non-renewal"

export type NonRenewalTarget = {
  franchiseId: string
  /** Every outlet on this invoice is recorded, and the invoice voided if open. */
  invoiceId?: string | null
  outletIds?: string[]
  /** Who it is about, for the title. */
  label: string
  /** A reason already on file, to correct it. */
  current?: { reason: string; note: string | null } | null
}

/**
 * Record why a merchant is not renewing, from the fixed list Analytics counts
 * by. Shared by the invoice page, the Renewal List and Actions Required.
 */
export function NonRenewalDialog({
  target,
  onOpenChange,
  onSaved,
}: {
  target: NonRenewalTarget | null
  onOpenChange: (open: boolean) => void
  onSaved: (message: string) => void
}) {
  const { showToast } = useToast()
  const [reason, setReason] = React.useState<NonRenewalReason | "">("")
  const [note, setNote] = React.useState("")
  const [busy, setBusy] = React.useState(false)

  React.useEffect(() => {
    if (target) {
      setReason((target.current?.reason as NonRenewalReason | undefined) ?? "")
      setNote(target.current?.note ?? "")
    }
  }, [target])

  const chosen = NON_RENEWAL_REASONS.find((entry) => entry.value === reason)
  const invalid = reason ? validateNonRenewal(reason, note) : "Choose a reason."

  async function save() {
    if (!target || !reason) return
    setBusy(true)
    try {
      const response = await fetch("/api/renewals/non-renewals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          franchiseId: target.franchiseId,
          invoiceId: target.invoiceId ?? null,
          outletIds: target.outletIds ?? [],
          reason,
          note: note.trim() || null,
        }),
      })
      const payload = (await response.json().catch(() => ({}))) as { error?: string; voidedInvoiceNumber?: string | null }
      if (!response.ok) {
        showToast(payload.error ?? "The reason could not be recorded.", "error")
        return
      }
      onSaved(
        payload.voidedInvoiceNumber
          ? `Recorded as ${chosen?.label ?? reason}. ${payload.voidedInvoiceNumber} was voided, so no more reminders go out.`
          : `Recorded as ${chosen?.label ?? reason}.`
      )
    } catch {
      showToast("Unable to reach the server. Try again.", "error")
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={target !== null} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Not renewing · {target?.label}</DialogTitle>
          <DialogDescription>
            Counted on Analytics under the reason you pick.
            {target?.invoiceId ? " The open document is voided, so no further reminders go out." : ""} If the merchant
            pays after all, the renewal wins.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 py-2">
          <div className="grid gap-2">
            <Label>Reason</Label>
            <Select value={reason} onValueChange={(value) => setReason(value as NonRenewalReason)}>
              <SelectTrigger>
                <SelectValue placeholder="Choose why" />
              </SelectTrigger>
              <SelectContent>
                {NON_RENEWAL_REASONS.map((entry) => (
                  <SelectItem key={entry.value} value={entry.value}>
                    {entry.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {chosen ? <span className="text-muted-foreground text-xs">{chosen.description}</span> : null}
          </div>
          <div className="grid gap-2">
            <Label htmlFor="nonRenewalNote">Note{reason === "other" ? "" : " (optional)"}</Label>
            <Textarea
              id="nonRenewalNote"
              rows={2}
              maxLength={1000}
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder={reason === "temp_close" || reason === "freeze_account" ? "When they expect to come back" : "What the merchant said"}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button size="sm" disabled={busy || invalid !== null} onClick={() => void save()}>
            {busy ? "Recording…" : "Record reason"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
