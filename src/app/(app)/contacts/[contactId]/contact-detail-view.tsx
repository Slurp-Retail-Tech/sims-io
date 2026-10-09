"use client"

import * as React from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { AlertTriangle, ChevronLeft, Pencil, Plus, Store, Trash2 } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { useToast } from "@/components/toast-provider"
import {
  groupMappingsByFranchise,
  summarizeMappings,
} from "@/lib/contact-mappings"
import { formatContactSource } from "@/lib/contacts"
import { resolveChannels } from "@/lib/renewal/pic-resolution"
import type { ContactChannelState } from "@/lib/renewal/pic-resolution"

import { ContactDialog } from "../contact-dialog"
import { MappingScopeBadge } from "../mapping-scope-badge"
import { ContactChannelsCard } from "./contact-channels-card"
import { MappingDialog } from "./mapping-dialog"
import { RenewalDesignation } from "./renewal-designation"
import type { Contact, ContactMappingRow } from "../types"

export function ContactDetailView({ contactId }: { contactId: string }) {
  const router = useRouter()
  const { showToast } = useToast()

  const [contact, setContact] = React.useState<Contact | null>(null)
  const [mappings, setMappings] = React.useState<ContactMappingRow[]>([])
  const [channels, setChannels] = React.useState<ContactChannelState[] | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)

  const [editOpen, setEditOpen] = React.useState(false)
  const [mappingOpen, setMappingOpen] = React.useState(false)
  const [confirmDelete, setConfirmDelete] = React.useState(false)
  const [deleting, setDeleting] = React.useState(false)
  const [removingMappingId, setRemovingMappingId] = React.useState<string | null>(null)
  // Holds the row awaiting confirmation. Carries the labels too, so the prompt can
  // name the exact mapping rather than asking about "this mapping".
  const [pendingRemoval, setPendingRemoval] = React.useState<{
    mappingId: string
    title: string
    franchiseLabel: string
  } | null>(null)

  const loadContact = React.useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const response = await fetch(`/api/contacts/${contactId}`)
      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as { error?: string }
        throw new Error(payload.error ?? "Unable to load contact.")
      }
      const payload = (await response.json()) as {
        contact: Contact
        mappings: ContactMappingRow[]
      }
      setContact(payload.contact)
      setMappings(payload.mappings ?? [])
    } catch (loadError) {
      console.error(loadError)
      // Clear the record so a failed reload never leaves a stale name on screen.
      setContact(null)
      setError(
        loadError instanceof Error ? loadError.message : "Unable to load contact."
      )
    } finally {
      setLoading(false)
    }
  }, [contactId])

  /**
   * Re-read the mappings without the page-level loading state.
   *
   * Toggling a renewal designation changes one row; running the full
   * `loadContact` would blank the whole record and flash the header for a
   * change the user made in place.
   */
  const refreshMappings = React.useCallback(async () => {
    try {
      const response = await fetch(`/api/contacts/${contactId}`, {
        cache: "no-store",
      })
      if (!response.ok) {
        return
      }
      const payload = (await response.json()) as {
        mappings: ContactMappingRow[]
      }
      setMappings(payload.mappings ?? [])
    } catch {
      // The row keeps its previous state; the next load corrects it.
    }
  }, [contactId])

  React.useEffect(() => {
    void loadContact()
  }, [loadContact])

  const handleDelete = async () => {
    setDeleting(true)
    try {
      const response = await fetch(`/api/contacts/${contactId}`, { method: "DELETE" })
      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as { error?: string }
        throw new Error(payload.error ?? "Unable to delete contact.")
      }
      showToast("Contact deleted.", "success")
      router.push("/contacts")
    } catch (deleteError) {
      console.error(deleteError)
      showToast(
        deleteError instanceof Error ? deleteError.message : "Unable to delete contact.",
        "error"
      )
    } finally {
      setDeleting(false)
      setConfirmDelete(false)
    }
  }

  const handleRemoveMapping = async () => {
    if (!pendingRemoval) {
      return
    }
    const { mappingId } = pendingRemoval
    setRemovingMappingId(mappingId)
    try {
      const response = await fetch(
        `/api/contacts/${contactId}/mappings/${mappingId}`,
        { method: "DELETE" }
      )
      const payload = (await response.json().catch(() => ({}))) as {
        mappings?: ContactMappingRow[]
        error?: string
      }
      if (!response.ok || !payload.mappings) {
        throw new Error(payload.error ?? "Unable to remove mapping.")
      }
      setMappings(payload.mappings)
      showToast("Mapping removed.", "success")
    } catch (removeError) {
      console.error(removeError)
      showToast(
        removeError instanceof Error ? removeError.message : "Unable to remove mapping.",
        "error"
      )
    } finally {
      setRemovingMappingId(null)
      setPendingRemoval(null)
    }
  }

  if (loading) {
    return <div className="text-muted-foreground text-sm">Loading contact...</div>
  }

  if (error || !contact) {
    return (
      <div className="flex flex-col items-start gap-4">
        <div className="text-destructive text-sm">{error ?? "Contact not found."}</div>
        <Button variant="outline" size="sm" asChild>
          <Link href="/contacts">
            <ChevronLeft />
            Back to contacts
          </Link>
        </Button>
      </div>
    )
  }

  const groups = groupMappingsByFranchise(mappings)

  // The same rule the nightly check applies, so this warning and the Actions
  // Required entry can never disagree. Withheld until the channels have
  // loaded, so the page never flashes a warning it would then retract.
  const isPicAnywhere = mappings.some((mapping) => mapping.isRenewalPic)
  const picUnreachable =
    isPicAnywhere &&
    channels !== null &&
    resolveChannels({
      contactId,
      name: contact.name,
      email: contact.email,
      primaryPhone:
        contact.phones.find((phone) => phone.isPrimary)?.phone ?? contact.phones[0]?.phone ?? null,
      channels,
    }).usable.length === 0

  return (
    <div className="animate-in fade-in slide-in-from-bottom-2 flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Button variant="outline" size="sm" asChild>
          <Link href="/contacts">
            <ChevronLeft />
            Back to contacts
          </Link>
        </Button>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => setEditOpen(true)}>
            <Pencil />
            Edit contact
          </Button>
          <Button variant="outline" size="sm" onClick={() => setConfirmDelete(true)}>
            <Trash2 />
            Delete
          </Button>
        </div>
      </div>

      <div>
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-semibold tracking-tight">{contact.name}</h1>
          <MappingScopeBadge
            tone={contact.source === "respond_io" ? "franchise" : "outlet"}
          >
            Source: {contact.source}
          </MappingScopeBadge>
        </div>
        <p className="text-muted-foreground mt-1 text-sm">
          {contact.role ?? "No role recorded"} · {summarizeMappings(mappings)}
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Contact details</CardTitle>
            <CardDescription>Name, email, role, and phone numbers.</CardDescription>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-1 gap-4 text-sm">
              <DetailRow label="Name" value={contact.name} />
              <DetailRow label="Email" value={contact.email} />
              <DetailRow label="Role / designation" value={contact.role ?? "--"} />
              <div>
                <dt className="text-muted-foreground mb-1 text-xs">Phone numbers</dt>
                <dd className="flex flex-col gap-1">
                  {contact.phones.length ? (
                    contact.phones.map((phone) => (
                      <div key={phone.id} className="flex items-center gap-2">
                        <span>{phone.phone}</span>
                        <span
                          className={
                            phone.isPrimary
                              ? "text-primary text-xs"
                              : "text-muted-foreground text-xs"
                          }
                        >
                          {phone.isPrimary ? "Primary" : "Secondary"}
                        </span>
                      </div>
                    ))
                  ) : (
                    <span className="text-muted-foreground">--</span>
                  )}
                </dd>
              </div>
              <DetailRow
                label="Respond.io contact"
                value={contact.respondioContactId ?? "--"}
              />
              <DetailRow label="Origin" value={formatContactSource(contact.source)} />
            </dl>
          </CardContent>
        </Card>

        <ContactChannelsCard
          contactId={contactId}
          email={contact.email}
          hasPhone={contact.phones.length > 0}
          onError={(message) => showToast(message, "error")}
          onChannelsChange={setChannels}
        />

        <Card>
          <CardHeader>
            <CardTitle>Outlet &amp; franchise mapping</CardTitle>
            <CardDescription>
              Grouped by franchise. A franchise-wide mapping covers every outlet under it.
            </CardDescription>
            <CardAction>
              <Button size="sm" onClick={() => setMappingOpen(true)}>
                <Plus />
                Add mapping
              </Button>
            </CardAction>
          </CardHeader>
          <CardContent>
            {picUnreachable ? (
              <div
                role="alert"
                className="mb-4 flex items-start gap-2.5 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2.5 text-[13px] text-amber-900 dark:text-amber-100"
              >
                <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                <span>
                  Renewals skip this contact. They are renewal PIC here, but no enabled channel has a usable
                  address, so the nightly check reports them as unreachable and raises no invoice. Enable Email
                  or WhatsApp above, with an address on the contact.
                </span>
              </div>
            ) : null}
            {groups.length ? (
              <div className="flex flex-col gap-4">
                {groups.map((group) => (
                  <div key={group.franchiseId} className="rounded-lg border">
                    <div className="flex items-center justify-between gap-2 border-b px-3 py-2">
                      <div className="flex min-w-0 items-center gap-2">
                        <Store className="text-muted-foreground size-4 shrink-0" />
                        <span className="truncate text-sm font-medium">
                          {group.franchiseName ?? `FID ${group.franchiseId}`}
                        </span>
                        <span className="text-muted-foreground shrink-0 text-xs">
                          FID {group.franchiseId}
                        </span>
                      </div>
                      <MappingScopeBadge
                        tone={group.franchiseWide ? "franchise" : "outlet"}
                      >
                        {group.badge}
                      </MappingScopeBadge>
                    </div>
                    <div className="flex flex-col">
                      {group.rows.map((row) => (
                        <div
                          key={row.mappingId}
                          className="flex items-center justify-between gap-2 border-b px-3 py-2 last:border-b-0"
                        >
                          <div className="flex min-w-0 flex-col">
                            <span className="truncate text-[13px]">{row.title}</span>
                            <span className="text-muted-foreground truncate text-xs">
                              {row.subtitle}
                            </span>
                          </div>
                          <div className="flex shrink-0 items-center gap-1">
                            <RenewalDesignation
                              mappingId={row.mappingId}
                              contactId={contactId}
                              isRenewalPic={row.isRenewalPic}
                              isRenewalCc={row.isRenewalCc}
                              onChanged={() => void refreshMappings()}
                              onError={(message) => showToast(message, "error")}
                            />
                            <Button
                              variant="ghost"
                              size="sm"
                              disabled={removingMappingId === row.mappingId}
                              onClick={() =>
                                setPendingRemoval({
                                  mappingId: row.mappingId,
                                  title: row.title,
                                  franchiseLabel:
                                    group.franchiseName ?? `FID ${group.franchiseId}`,
                                })
                              }
                            >
                              {removingMappingId === row.mappingId
                                ? "Removing..."
                                : "Remove"}
                            </Button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
                <p className="text-muted-foreground text-xs">
                  Removing a mapping leaves the contact and its other mappings untouched.
                  PIC marks who is accountable for that scope&apos;s renewal — one
                  contact per scope. CC copies them on the same messages.
                </p>
              </div>
            ) : (
              <div className="text-muted-foreground text-sm">
                No mappings yet. Add one to make this contact appear on an outlet&apos;s
                record.
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <ContactDialog
        open={editOpen}
        contact={contact}
        onClose={() => setEditOpen(false)}
        onSaved={(updated) => {
          setEditOpen(false)
          setContact(updated)
        }}
      />

      <MappingDialog
        open={mappingOpen}
        contactId={contactId}
        existing={mappings}
        onClose={() => setMappingOpen(false)}
        onSaved={(next) => {
          setMappingOpen(false)
          setMappings(next)
        }}
      />

      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title="Delete this contact?"
        description="The contact is hidden from the directory, search, and the shared picker. Its mappings and phone numbers are retained for audit."
        confirmLabel="Delete contact"
        destructive
        loading={deleting}
        onConfirm={handleDelete}
      />

      <ConfirmDialog
        open={Boolean(pendingRemoval)}
        onOpenChange={(next) => {
          if (!next) {
            setPendingRemoval(null)
          }
        }}
        title="Remove this mapping?"
        description={
          pendingRemoval
            ? `${pendingRemoval.title} (${pendingRemoval.franchiseLabel}) will no longer list ${contact.name} as a contact, and inbound conversations from them will stop linking to it automatically. The contact and its other mappings are untouched.`
            : undefined
        }
        confirmLabel="Remove mapping"
        destructive
        loading={Boolean(removingMappingId)}
        onConfirm={() => void handleRemoveMapping()}
      />
    </div>
  )
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-muted-foreground mb-1 text-xs">{label}</dt>
      <dd className="break-words">{value}</dd>
    </div>
  )
}
