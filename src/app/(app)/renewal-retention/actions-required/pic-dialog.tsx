"use client"

import * as React from "react"
import Link from "next/link"
import { AlertCircle, AlertTriangle, Building2, Check, Store } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { cn } from "@/lib/utils"

import { Pill } from "../ui"

type Channel = "email" | "whatsapp"

type PicCandidate = {
  mappingId: string
  contactId: string
  name: string
  email: string | null
  phone: string | null
  scope: "outlet" | "franchise"
  isRenewalPic: boolean
  isRenewalCc: boolean
  usable: Channel[]
  unusable: Channel[]
}

export type PicTarget = {
  franchiseId: string
  /** Null for a franchise-level gap: only franchise-wide contacts qualify. */
  outletId: string | null
  label: string
}

const CHANNEL_LABEL: Record<Channel, string> = { email: "Email", whatsapp: "WhatsApp" }

/**
 * Make one of the contacts already mapped to an outlet (or its franchise) the
 * renewal PIC, without leaving Actions Required.
 *
 * Lists the outlet's own contacts and the franchise-wide ones, each with
 * whether a message could reach them, and designates the chosen mapping
 * through the same endpoint the contact page uses, so the single-PIC rule and
 * its "already the PIC" refusal apply unchanged. Adding or mapping a new
 * contact still happens on Contacts; the panel links there.
 */
export function PicDialog({
  open,
  onOpenChange,
  target,
  onSaved,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  target: PicTarget | null
  onSaved: (picName: string) => void
}) {
  const [candidates, setCandidates] = React.useState<PicCandidate[] | null>(null)
  const [loadError, setLoadError] = React.useState<string | null>(null)
  const [selected, setSelected] = React.useState<string | null>(null)
  const [saving, setSaving] = React.useState(false)
  const [saveError, setSaveError] = React.useState<string | null>(null)

  const franchiseId = target?.franchiseId ?? null
  const outletId = target?.outletId ?? null

  React.useEffect(() => {
    if (!open || !franchiseId) {
      return
    }
    setCandidates(null)
    setLoadError(null)
    setSelected(null)
    setSaveError(null)
    const controller = new AbortController()
    const query = new URLSearchParams({ fid: franchiseId, ...(outletId ? { oid: outletId } : {}) })
    fetch(`/api/renewals/pic-candidates?${query.toString()}`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const payload = (await response.json().catch(() => ({}))) as { candidates?: PicCandidate[]; error?: string }
        if (!response.ok) {
          throw new Error(payload.error ?? "Unable to load the contacts.")
        }
        const list = payload.candidates ?? []
        setCandidates(list)
        // Pre-select the first reachable contact: the list is ordered so it is
        // the likely choice.
        setSelected(list.find((candidate) => candidate.usable.length > 0)?.mappingId ?? null)
      })
      .catch((error: unknown) => {
        if ((error as Error).name !== "AbortError") {
          setLoadError(error instanceof Error ? error.message : "Unable to load the contacts.")
        }
      })
    return () => controller.abort()
  }, [open, franchiseId, outletId])

  const chosen = candidates?.find((candidate) => candidate.mappingId === selected) ?? null
  const contactsHref = franchiseId ? `/contacts?fid=${encodeURIComponent(franchiseId)}` : "/contacts"

  async function save() {
    if (!chosen) {
      return
    }
    setSaving(true)
    setSaveError(null)
    try {
      const response = await fetch(`/api/contacts/${chosen.contactId}/mappings/${chosen.mappingId}/renewal`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        // Keeps a CC designation on the same mapping: PIC and CC are separate.
        body: JSON.stringify({ isRenewalPic: true, isRenewalCc: chosen.isRenewalCc }),
      })
      const payload = (await response.json().catch(() => ({}))) as { error?: string }
      if (!response.ok) {
        setSaveError(payload.error ?? "Unable to set the renewal PIC.")
        return
      }
      onSaved(chosen.name)
      onOpenChange(false)
    } catch {
      setSaveError("Unable to reach the server. Try again.")
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{outletId ? "Set renewal PIC" : "Set franchise PIC"}</DialogTitle>
          <DialogDescription>
            {target ? `For ${target.label}. ` : ""}
            {outletId
              ? "Choose who renewal invoices and reminders go to. A franchise-wide contact covers every outlet without its own PIC."
              : "Outlets on this grouped invoice resolve to different PICs. One franchise-wide PIC gives the invoice a single addressee."}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3 py-2">
          {loadError ? (
            <p role="alert" className="text-destructive flex items-center gap-2 text-sm">
              <AlertCircle className="size-4 shrink-0" />
              {loadError}
            </p>
          ) : candidates === null ? (
            <p className="text-muted-foreground text-sm">Loading contacts…</p>
          ) : candidates.length === 0 ? (
            <div className="rounded-[calc(var(--radius)-2px)] border border-dashed p-4 text-sm">
              <p className="font-medium">No contacts are mapped here yet.</p>
              <p className="text-muted-foreground mt-1 text-[0.8125rem]">
                {outletId
                  ? "Map a contact to this outlet or to its whole franchise on the Contacts page, then set them as PIC."
                  : "Map a contact to the whole franchise on the Contacts page, then set them as PIC."}
              </p>
            </div>
          ) : (
            <div role="radiogroup" aria-label="Contacts" className="grid max-h-[22rem] gap-2 overflow-y-auto">
              {candidates.map((candidate) => {
                const active = candidate.mappingId === selected
                const reachable = candidate.usable.length > 0
                return (
                  <button
                    key={candidate.mappingId}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    onClick={() => setSelected(candidate.mappingId)}
                    className={cn(
                      "flex items-start gap-3 rounded-[calc(var(--radius)-2px)] border p-3 text-left transition-colors",
                      active ? "border-primary bg-primary/5" : "hover:bg-accent/40"
                    )}
                  >
                    <span
                      className={cn(
                        "mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border",
                        active ? "border-primary bg-primary text-primary-foreground" : "border-muted-foreground/40"
                      )}
                    >
                      {active ? <Check className="size-3" /> : null}
                    </span>
                    <span className="flex min-w-0 flex-1 flex-col gap-1">
                      <span className="flex flex-wrap items-center gap-1.5">
                        <span className="text-sm font-medium">{candidate.name}</span>
                        <Pill tone="gray" className="gap-1">
                          {candidate.scope === "outlet" ? <Store className="size-3" /> : <Building2 className="size-3" />}
                          {candidate.scope === "outlet" ? "This outlet" : "Whole franchise"}
                        </Pill>
                        {candidate.isRenewalCc ? <Pill tone="blue">CC</Pill> : null}
                      </span>
                      <span className="text-muted-foreground truncate text-xs">
                        {[candidate.email, candidate.phone].filter(Boolean).join(" · ") || "No email or phone"}
                      </span>
                      <span className={cn("text-xs", reachable ? "text-emerald-700 dark:text-emerald-300" : "text-amber-700 dark:text-amber-300")}>
                        {reachable
                          ? `Reachable by ${candidate.usable.map((channel) => CHANNEL_LABEL[channel]).join(" and ")}`
                          : candidate.unusable.length > 0
                            ? `${candidate.unusable.map((channel) => CHANNEL_LABEL[channel]).join(" and ")} enabled without an address`
                            : "No channel enabled"}
                      </span>
                    </span>
                  </button>
                )
              })}
            </div>
          )}

          {chosen && chosen.usable.length === 0 ? (
            <p className="flex items-start gap-2 text-xs text-amber-800 dark:text-amber-200">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
              Renewals skip this contact until Email or WhatsApp is enabled with an address. You can still make them PIC
              and fix their channels on the contact page; the entry then becomes &ldquo;PIC cannot be reached&rdquo;.
            </p>
          ) : null}
          {saveError ? (
            <p role="alert" className="text-destructive flex items-center gap-2 text-sm">
              <AlertCircle className="size-4 shrink-0" />
              {saveError}
            </p>
          ) : null}
        </div>

        <DialogFooter className="sm:justify-between">
          <Button variant="link" size="sm" className="px-0" asChild>
            <Link href={contactsHref}>Open Contacts</Link>
          </Button>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => onOpenChange(false)} disabled={saving}>
              Cancel
            </Button>
            <Button size="sm" onClick={() => void save()} disabled={!chosen || saving}>
              {saving ? "Saving…" : chosen ? `Make ${chosen.name} PIC` : "Make PIC"}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
