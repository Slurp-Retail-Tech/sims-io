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
import { useToast } from "@/components/toast-provider"

import { PillTabs } from "../ui"

/** Mirrors `BillingProfile` in `src/lib/renewal/billing-profiles.ts`. */
export type Profile = {
  franchiseId: string
  bukkuContactCode: string | null
  legalName: string | null
  regNoType: string | null
  registrationNo: string | null
  oldRegistrationNo: string | null
  tin: string | null
  sstNo: string | null
  street: string | null
  city: string | null
  state: string | null
  postcode: string | null
  country: string | null
  source: "bukku" | "manual"
  matchStatus: "auto" | "confirmed" | "manual"
  updatedAt: string | null
}

export type Candidate = { contactCode: string; legalName: string; registrationNo: string | null; tin: string | null }

type ContactHit = Candidate & { otherName: string | null }

type Mode = "bukku" | "manual"

type ManualField =
  | "legalName"
  | "registrationNo"
  | "oldRegistrationNo"
  | "tin"
  | "sstNo"
  | "street"
  | "city"
  | "state"
  | "postcode"
  | "country"
  | "bukkuContactCode"

type ManualDraft = Record<ManualField, string> & { regNoType: string }

function toDraft(profile: Profile | null, companyName: string | null): ManualDraft {
  return {
    legalName: profile?.legalName ?? companyName ?? "",
    regNoType: profile?.regNoType ?? "BRN",
    registrationNo: profile?.registrationNo ?? "",
    oldRegistrationNo: profile?.oldRegistrationNo ?? "",
    tin: profile?.tin ?? "",
    sstNo: profile?.sstNo ?? "",
    street: profile?.street ?? "",
    city: profile?.city ?? "",
    state: profile?.state ?? "",
    postcode: profile?.postcode ?? "",
    country: profile?.country ?? "MY",
    bukkuContactCode: profile?.bukkuContactCode ?? "",
  }
}

/**
 * Set one franchise's billing profile: confirm the importer's match, pick a
 * candidate or any imported Bukku contact, or type the details in. Saving
 * reprints the franchise's open proformas with the new Bill To.
 */
export function ProfileDialog({
  open,
  onOpenChange,
  franchiseId,
  companyName,
  profile,
  candidates,
  defaultDocument,
  onSaved,
  onDefaultDocumentChanged,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  franchiseId: string
  companyName: string | null
  profile: Profile | null
  candidates: Candidate[]
  defaultDocument: "proforma" | "quotation"
  onSaved: (message: string) => void
  /** Saved on its own click, without closing the dialog. */
  onDefaultDocumentChanged: (value: "proforma" | "quotation") => void
}) {
  const { showToast } = useToast()
  const [documentType, setDocumentType] = React.useState(defaultDocument)
  const [mode, setMode] = React.useState<Mode>(profile?.source === "manual" ? "manual" : "bukku")
  const [draft, setDraft] = React.useState<ManualDraft>(() => toDraft(profile, companyName))
  const [query, setQuery] = React.useState("")
  const [hits, setHits] = React.useState<ContactHit[]>([])
  const [searching, setSearching] = React.useState(false)
  const [busy, setBusy] = React.useState(false)

  React.useEffect(() => {
    const term = query.trim()
    if (term.length < 2) {
      setHits([])
      return
    }
    const controller = new AbortController()
    const timer = window.setTimeout(async () => {
      setSearching(true)
      try {
        const response = await fetch(`/api/renewals/billing-profiles/contacts?q=${encodeURIComponent(term)}`, {
          signal: controller.signal,
        })
        const payload = (await response.json().catch(() => ({}))) as { contacts?: ContactHit[] }
        setHits(payload.contacts ?? [])
      } catch {
        // Aborted by the next keystroke, or offline; the list simply stays as it was.
      } finally {
        setSearching(false)
      }
    }, 250)
    return () => {
      controller.abort()
      window.clearTimeout(timer)
    }
  }, [query])

  async function send(method: "PUT" | "DELETE", body?: Record<string, unknown>): Promise<{ documentsRefreshed?: number } | null> {
    setBusy(true)
    try {
      const response = await fetch(`/api/renewals/billing-profiles/${encodeURIComponent(franchiseId)}`, {
        method,
        headers: body ? { "Content-Type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      })
      const payload = (await response.json().catch(() => ({}))) as { error?: string; documentsRefreshed?: number }
      if (!response.ok) {
        showToast(payload.error ?? "Unable to save the billing profile.", "error")
        return null
      }
      return payload
    } catch {
      showToast("Unable to reach the server. Try again.", "error")
      return null
    } finally {
      setBusy(false)
    }
  }

  function savedMessage(prefix: string, refreshed: number | undefined): string {
    return refreshed ? `${prefix} ${refreshed} open document${refreshed === 1 ? "" : "s"} will reprint with it.` : prefix
  }

  async function link(contactCode: string) {
    const result = await send("PUT", { action: "link", contactCode })
    if (result) onSaved(savedMessage(`Linked to ${contactCode}.`, result.documentsRefreshed))
  }

  async function confirm() {
    const result = await send("PUT", { action: "confirm" })
    if (result) onSaved(savedMessage("Match confirmed.", result.documentsRefreshed))
  }

  async function saveManual() {
    const result = await send("PUT", { action: "manual", ...draft })
    if (result) onSaved(savedMessage("Billing profile saved.", result.documentsRefreshed))
  }

  async function changeDefaultDocument(value: "proforma" | "quotation") {
    if (value === documentType) return
    const previous = documentType
    setDocumentType(value)
    const result = await send("PUT", { action: "set_default_document", defaultDocument: value })
    if (result) {
      onDefaultDocumentChanged(value)
      showToast(value === "quotation" ? "New renewals will be issued as quotations." : "New renewals will be issued as proformas.", "success")
    } else {
      setDocumentType(previous)
    }
  }

  async function remove() {
    const result = await send("DELETE")
    if (result) onSaved(savedMessage("Billing profile removed.", result.documentsRefreshed))
  }

  const field = (key: ManualField, label: string, placeholder?: string) => (
    <div className="grid gap-1.5">
      <Label htmlFor={`bp-${key}`} className="text-xs">
        {label}
      </Label>
      <Input
        id={`bp-${key}`}
        value={draft[key]}
        placeholder={placeholder}
        onChange={(event) => setDraft({ ...draft, [key]: event.target.value })}
        className="h-8"
      />
    </div>
  )

  const contactList = (contacts: ContactHit[] | Candidate[], empty: string) =>
    contacts.length === 0 ? (
      <p className="text-muted-foreground py-1 text-xs">{empty}</p>
    ) : (
      <div className="grid gap-1.5">
        {contacts.map((contact) => (
          <div key={contact.contactCode} className="flex items-center justify-between gap-3 rounded-md border px-3 py-2">
            <div className="flex min-w-0 flex-col">
              <span className="truncate text-sm">{contact.legalName}</span>
              <span className="text-muted-foreground truncate text-xs">
                {[contact.contactCode, contact.registrationNo, contact.tin ? `TIN ${contact.tin}` : null].filter(Boolean).join(" · ")}
              </span>
            </div>
            <Button
              size="sm"
              variant={profile?.bukkuContactCode === contact.contactCode ? "outline" : "default"}
              disabled={busy}
              onClick={() => void link(contact.contactCode)}
            >
              {profile?.bukkuContactCode === contact.contactCode ? "Re-link" : "Link"}
            </Button>
          </div>
        ))}
      </div>
    )

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Billing profile · {companyName ?? `Franchise ${franchiseId}`}</DialogTitle>
          <DialogDescription>
            Printed under Bill To on FID {franchiseId}&rsquo;s renewal documents. Open proformas reprint with the change;
            paid ones keep the details they were paid against.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border px-3 py-2.5">
          <div className="flex min-w-0 flex-col">
            <span className="text-sm">Issue renewals as</span>
            <span className="text-muted-foreground text-xs">
              For companies that only pay against a quotation. Open documents are switched on their invoice page.
            </span>
          </div>
          <PillTabs<"proforma" | "quotation">
            size="sm"
            value={documentType}
            onChange={(value) => void changeDefaultDocument(value)}
            tabs={[
              { key: "proforma", label: "Proforma" },
              { key: "quotation", label: "Quotation" },
            ]}
          />
        </div>

        <PillTabs<Mode>
          size="sm"
          value={mode}
          onChange={setMode}
          tabs={[
            { key: "bukku", label: "Bukku contact" },
            { key: "manual", label: "Enter by hand" },
          ]}
        />

        {mode === "bukku" ? (
          <div className="grid gap-4 py-1">
            {profile?.matchStatus === "auto" && profile.bukkuContactCode ? (
              <div className="flex items-center justify-between gap-3 rounded-md border border-blue-200 bg-blue-50 px-3 py-2 dark:border-blue-900 dark:bg-blue-950/40">
                <span className="text-sm">
                  Matched automatically to <span className="font-mono text-xs">{profile.bukkuContactCode}</span>,{" "}
                  {profile.legalName}.
                </span>
                <Button size="sm" disabled={busy} onClick={() => void confirm()}>
                  Confirm
                </Button>
              </div>
            ) : null}
            {candidates.length > 0 ? (
              <div className="grid gap-2">
                <div className="text-muted-foreground text-xs">Possible matches from the last import</div>
                {contactList(candidates, "")}
              </div>
            ) : null}
            <div className="grid gap-2">
              <Label htmlFor="bp-search" className="text-xs">
                Search imported contacts
              </Label>
              <Input
                id="bp-search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Legal name, contact code or SSM number"
                className="h-8"
              />
              {query.trim().length >= 2
                ? contactList(hits, searching ? "Searching…" : "No imported contact matches. Import a newer export, or enter the details by hand.")
                : null}
            </div>
          </div>
        ) : (
          <div className="grid gap-3 py-1">
            {field("legalName", "Registered company name")}
            <div className="grid grid-cols-[7rem_1fr] gap-3">
              <div className="grid gap-1.5">
                <Label className="text-xs">Reg. type</Label>
                <Select value={draft.regNoType} onValueChange={(value) => setDraft({ ...draft, regNoType: value })}>
                  <SelectTrigger className="h-8">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="BRN">SSM (BRN)</SelectItem>
                    <SelectItem value="NRIC">NRIC</SelectItem>
                    <SelectItem value="PASSPORT">Passport</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {field("registrationNo", "Registration no.", "e.g. 202103124055")}
            </div>
            <div className="grid grid-cols-2 gap-3">
              {field("oldRegistrationNo", "Old registration no.", "e.g. 1234567-X")}
              {field("tin", "TIN", "e.g. C26134056050")}
            </div>
            <div className="grid grid-cols-2 gap-3">
              {field("sstNo", "SST registration no.")}
              {field("bukkuContactCode", "Bukku contact code", "For the export")}
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="bp-street" className="text-xs">
                Billing address
              </Label>
              <Textarea
                id="bp-street"
                rows={3}
                value={draft.street}
                onChange={(event) => setDraft({ ...draft, street: event.target.value })}
                placeholder="One line per printed line"
              />
            </div>
            <div className="grid grid-cols-[6rem_1fr] gap-3">
              {field("postcode", "Postcode")}
              {field("city", "City")}
            </div>
            <div className="grid grid-cols-[1fr_5rem] gap-3">
              {field("state", "State")}
              {field("country", "Country")}
            </div>
          </div>
        )}

        <DialogFooter className="gap-2 sm:justify-between">
          {profile ? (
            <Button variant="ghost" size="sm" className="text-destructive" disabled={busy} onClick={() => void remove()}>
              Remove profile
            </Button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => onOpenChange(false)} disabled={busy}>
              Close
            </Button>
            {mode === "manual" ? (
              <Button size="sm" disabled={busy || !draft.legalName.trim()} onClick={() => void saveManual()}>
                {busy ? "Saving…" : "Save details"}
              </Button>
            ) : null}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
