"use client"

import * as React from "react"
import { BellRing, Copy } from "lucide-react"

import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

type RenewalDesignationProps = {
  mappingId: string
  contactId: string
  isRenewalPic: boolean
  isRenewalCc: boolean
  onChanged: () => void
  onError: (message: string) => void
}

/**
 * Designate one mapping as the renewal PIC and/or a CC.
 *
 * The two are independent toggles rather than one three-way choice, because
 * they are independent facts: being copied on a renewal and being accountable
 * for it are different things, and a contact can stop being the PIC without
 * ceasing to be copied.
 *
 * Only the PIC toggle can be refused. At most one contact may be PIC for a
 * given franchise-and-outlet scope, and the server names whoever already holds
 * it rather than silently taking it away from them.
 */
export function RenewalDesignation({
  mappingId,
  contactId,
  isRenewalPic,
  isRenewalCc,
  onChanged,
  onError,
}: RenewalDesignationProps) {
  const [saving, setSaving] = React.useState(false)

  async function update(next: { isRenewalPic: boolean; isRenewalCc: boolean }) {
    setSaving(true)
    try {
      const response = await fetch(
        `/api/contacts/${contactId}/mappings/${mappingId}/renewal`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(next),
        }
      )

      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as {
          error?: string
        }
        onError(payload.error ?? "Unable to save the designation.")
        return
      }

      onChanged()
    } catch {
      onError("Unable to reach the server. Try again.")
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex items-center gap-1">
      <Button
        size="sm"
        variant={isRenewalPic ? "default" : "ghost"}
        className={cn("h-7 gap-1.5 px-2 text-xs", !isRenewalPic && "text-muted-foreground")}
        disabled={saving}
        aria-pressed={isRenewalPic}
        title={
          isRenewalPic
            ? "Accountable for this scope's renewal"
            : "Make this contact accountable for renewals here"
        }
        onClick={() =>
          void update({ isRenewalPic: !isRenewalPic, isRenewalCc })
        }
      >
        <BellRing className="size-3.5" />
        PIC
      </Button>
      <Button
        size="sm"
        variant={isRenewalCc ? "secondary" : "ghost"}
        className={cn("h-7 gap-1.5 px-2 text-xs", !isRenewalCc && "text-muted-foreground")}
        disabled={saving}
        aria-pressed={isRenewalCc}
        title={
          isRenewalCc
            ? "Copied on renewal reminders and receipts"
            : "Copy this contact on renewal reminders and receipts"
        }
        onClick={() =>
          void update({ isRenewalPic, isRenewalCc: !isRenewalCc })
        }
      >
        <Copy className="size-3.5" />
        CC
      </Button>
    </div>
  )
}
