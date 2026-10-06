"use client"

import * as React from "react"
import Link from "next/link"
import { AlertCircle, AlertTriangle, Building2, Check, Store, UserPlus } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
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

type NewContactForm = {
  name: string
  email: string
  phone: string
  role: string
  scope: "outlet" | "franchise"
  email_enabled: boolean
  whatsapp_enabled: boolean
}

type DuplicateMatch = { contactId: string; name: string; role: string | null; matchedOn: "email" | "phone"; matchedValue: string }

const EMPTY_FORM: NewContactForm = {
  name: "",
  email: "",
  phone: "",
  role: "",
  scope: "outlet",
  email_enabled: true,
  whatsapp_enabled: true,
}

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
  // "create": the new-contact form, shown straight away when nobody is
  // mapped here and behind "Add someone not listed" otherwise.
  const [mode, setMode] = React.useState<"pick" | "create">("pick")
  const [form, setForm] = React.useState<NewContactForm>(EMPTY_FORM)
  const [fieldErrors, setFieldErrors] = React.useState<Record<string, string>>({})
  const [matches, setMatches] = React.useState<DuplicateMatch[]>([])

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
    setMode("pick")
    setForm({ ...EMPTY_FORM, scope: outletId ? "outlet" : "franchise" })
    setFieldErrors({})
    setMatches([])
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
        if (list.length === 0) {
          setMode("create")
        }
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

  /**
   * Add a new contact (or, after a duplicate match, use the existing one),
   * map them here and make them PIC, in one request.
   */
  async function createAndDesignate(existingContactId?: string) {
    if (!franchiseId) {
      return
    }
    setSaving(true)
    setSaveError(null)
    setFieldErrors({})
    try {
      const response = await fetch("/api/renewals/pic-candidates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          franchiseId,
          outletId,
          scope: form.scope,
          ...(existingContactId
            ? { existingContactId }
            : {
                contact: {
                  name: form.name,
                  email: form.email,
                  role: form.role,
                  phones: form.phone.trim() ? [form.phone] : [],
                  channels: { email: form.email_enabled, whatsapp: form.whatsapp_enabled },
                },
              }),
        }),
      })
      const payload = (await response.json().catch(() => ({}))) as {
        error?: string
        errors?: Record<string, string>
        matches?: DuplicateMatch[]
        contactName?: string
      }
      if (response.ok) {
        onSaved(payload.contactName ?? form.name)
        onOpenChange(false)
        return
      }
      if (payload.matches?.length) {
        setMatches(payload.matches)
        return
      }
      if (payload.errors) {
        setFieldErrors(payload.errors)
      }
      setSaveError(payload.errors ? null : payload.error ?? "Unable to set the renewal PIC.")
    } catch {
      setSaveError("Unable to reach the server. Try again.")
    } finally {
      setSaving(false)
    }
  }

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
          ) : mode === "create" ? (
            <NewContactFields
              form={form}
              setForm={setForm}
              errors={fieldErrors}
              onEdit={(key) =>
                setFieldErrors((current) => {
                  const next = { ...current }
                  delete next[key]
                  return next
                })
              }
              allowOutletScope={outletId !== null}
              intro={
                candidates.length === 0
                  ? outletId
                    ? "Nobody is mapped to this outlet or its franchise yet. Add the person who handles renewals; they are added to Contacts, mapped here and made PIC."
                    : "Nobody is mapped to this franchise yet. Add the person who handles renewals for the whole franchise."
                  : "Add someone who is not listed. They are added to Contacts, mapped here and made PIC."
              }
              matches={matches}
              saving={saving}
              onUseExisting={(contactId) => void createAndDesignate(contactId)}
            />
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

          {mode === "pick" && candidates && candidates.length > 0 ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="text-muted-foreground self-start"
              onClick={() => {
                setMode("create")
                setSaveError(null)
              }}
            >
              <UserPlus className="size-4" />
              Add someone not listed
            </Button>
          ) : null}

          {mode === "pick" && chosen && chosen.usable.length === 0 ? (
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
            {mode === "create" && candidates && candidates.length > 0 ? (
              <Button variant="outline" size="sm" onClick={() => setMode("pick")} disabled={saving}>
                Back to the list
              </Button>
            ) : (
              <Button variant="outline" size="sm" onClick={() => onOpenChange(false)} disabled={saving}>
                Cancel
              </Button>
            )}
            {mode === "create" ? (
              <Button
                size="sm"
                onClick={() => void createAndDesignate()}
                disabled={saving || !form.name.trim() || !form.email.trim() || !form.phone.trim()}
              >
                {saving ? "Saving…" : "Add and make PIC"}
              </Button>
            ) : (
              <Button size="sm" onClick={() => void save()} disabled={!chosen || saving}>
                {saving ? "Saving…" : chosen ? `Make ${chosen.name} PIC` : "Make PIC"}
              </Button>
            )}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/**
 * The new-contact fields: what the Contacts page requires (name, email, a
 * phone), where they are mapped, and which channels renewals may use. A
 * duplicate found on submit is offered back as "use this person", since
 * creating a second record for them is refused anyway.
 */
function NewContactFields({
  form,
  setForm,
  errors,
  onEdit,
  allowOutletScope,
  intro,
  matches,
  saving,
  onUseExisting,
}: {
  form: NewContactForm
  setForm: React.Dispatch<React.SetStateAction<NewContactForm>>
  errors: Record<string, string>
  /** A field was edited: its error, about the old value, no longer applies. */
  onEdit: (errorKey: string) => void
  allowOutletScope: boolean
  intro: string
  matches: DuplicateMatch[]
  saving: boolean
  onUseExisting: (contactId: string) => void
}) {
  const field = (key: "name" | "email" | "phone" | "role", label: string, props: React.ComponentProps<typeof Input> = {}) => {
    const errorKey = key === "phone" ? "phones" : key
    return (
      <div className="grid gap-1.5">
        <Label htmlFor={`pic-${key}`}>{label}</Label>
        <Input
          id={`pic-${key}`}
          value={form[key]}
          onChange={(event) => {
            setForm((current) => ({ ...current, [key]: event.target.value }))
            if (errors[errorKey]) {
              onEdit(errorKey)
            }
          }}
          aria-invalid={Boolean(errors[errorKey])}
          disabled={saving}
          {...props}
        />
        {errors[errorKey] ? <p className="text-destructive text-xs">{errors[errorKey]}</p> : null}
      </div>
    )
  }

  // Unique by contact: a submission can match one person on email and the
  // same person on phone.
  const people = [...new Map(matches.map((match) => [match.contactId, match])).values()]

  return (
    <div className="grid gap-3">
      <p className="text-muted-foreground text-[0.8125rem] text-pretty">{intro}</p>

      {people.length > 0 ? (
        <div role="alert" className="grid gap-2 rounded-[calc(var(--radius)-2px)] border border-amber-500/40 bg-amber-500/10 p-3">
          <p className="text-sm font-medium">Already in Contacts</p>
          {people.map((person) => (
            <div key={person.contactId} className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-[0.8125rem]">
                {person.name}
                {person.role ? ` · ${person.role}` : ""}
                <span className="text-muted-foreground"> · same {person.matchedOn} ({person.matchedValue})</span>
              </span>
              <Button size="sm" variant="outline" disabled={saving} onClick={() => onUseExisting(person.contactId)}>
                Make {person.name} PIC
              </Button>
            </div>
          ))}
        </div>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2">
        {field("name", "Name", { placeholder: "Full name", autoComplete: "off" })}
        {field("role", "Role (optional)", { placeholder: "e.g. Owner, Finance" })}
        {field("email", "Email", { type: "email", placeholder: "name@company.com", autoComplete: "off" })}
        {field("phone", "Phone", { inputMode: "tel", placeholder: "e.g. 012-345 6789", autoComplete: "off" })}
      </div>

      {allowOutletScope ? (
        <div className="grid gap-1.5">
          <span className="text-sm font-medium">PIC for</span>
          <div role="radiogroup" aria-label="PIC for" className="grid grid-cols-2 gap-2">
            {(["outlet", "franchise"] as const).map((scope) => (
              <button
                key={scope}
                type="button"
                role="radio"
                aria-checked={form.scope === scope}
                disabled={saving}
                onClick={() => setForm((current) => ({ ...current, scope }))}
                className={cn(
                  "flex items-center gap-2 rounded-[calc(var(--radius)-2px)] border px-3 py-2 text-left text-[0.8125rem] transition-colors",
                  form.scope === scope ? "border-primary bg-primary/5" : "hover:bg-accent/40"
                )}
              >
                {scope === "outlet" ? <Store className="size-4" /> : <Building2 className="size-4" />}
                <span className="flex flex-col">
                  <span className="font-medium">{scope === "outlet" ? "This outlet" : "Whole franchise"}</span>
                  <span className="text-muted-foreground text-xs">
                    {scope === "outlet" ? "Only this outlet" : "Every outlet without its own PIC"}
                  </span>
                </span>
              </button>
            ))}
          </div>
        </div>
      ) : null}

      <div className="grid gap-1.5">
        <span className="text-sm font-medium">Send renewals by</span>
        <div className="flex flex-wrap gap-4">
          {(["email", "whatsapp"] as const).map((channel) => (
            <label key={channel} className="flex items-center gap-2 text-[0.8125rem]">
              <Checkbox
                checked={form[`${channel}_enabled`]}
                disabled={saving}
                onCheckedChange={(checked) => setForm((current) => ({ ...current, [`${channel}_enabled`]: checked === true }))}
              />
              {CHANNEL_LABEL[channel]}
            </label>
          ))}
        </div>
        {!form.email_enabled && !form.whatsapp_enabled ? (
          <p className="flex items-start gap-2 text-xs text-amber-800 dark:text-amber-200">
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
            With neither channel on, renewals skip this contact and the entry becomes &ldquo;PIC cannot be reached&rdquo;.
          </p>
        ) : null}
      </div>
    </div>
  )
}
