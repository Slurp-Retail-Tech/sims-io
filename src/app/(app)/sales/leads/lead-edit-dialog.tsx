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
import { Field, FieldError, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import type { MappedLead } from "@/lib/leads"
import type { AssignableUser } from "./types"

const UNASSIGNED_VALUE = "__unassigned__"

type EditDraft = {
  name: string
  telephone: string
  email: string
  businessName: string
  businessType: string
  businessLocation: string
  assignedUserId: string
}

function draftFromLead(lead: MappedLead): EditDraft {
  return {
    name: lead.name,
    telephone: lead.telephone,
    email: lead.email ?? "",
    businessName: lead.businessName ?? "",
    businessType: lead.businessType,
    businessLocation: lead.businessLocation,
    assignedUserId: lead.assignedUserId ?? UNASSIGNED_VALUE,
  }
}

type LeadEditDialogProps = {
  leadId: string
  lead: MappedLead
  isManager: boolean
  open: boolean
  onClose: () => void
  onSaved: (lead: MappedLead) => void
}

export function LeadEditDialog({
  leadId,
  lead,
  isManager,
  open,
  onClose,
  onSaved,
}: LeadEditDialogProps) {
  const { showToast } = useToast()
  const [draft, setDraft] = React.useState<EditDraft>(() => draftFromLead(lead))
  const [errors, setErrors] = React.useState<Record<string, string>>({})
  const [saving, setSaving] = React.useState(false)
  const [assignableUsers, setAssignableUsers] = React.useState<AssignableUser[]>([])

  React.useEffect(() => {
    if (!open) {
      return
    }
    setDraft(draftFromLead(lead))
    setErrors({})
  }, [open, lead])

  React.useEffect(() => {
    if (!open || !isManager) {
      return
    }
    const loadUsers = async () => {
      try {
        const response = await fetch("/api/users/sales-agents")
        if (!response.ok) {
          return
        }
        const data = (await response.json()) as { users: AssignableUser[] }
        setAssignableUsers(data.users ?? [])
      } catch {
        // optional
      }
    }
    void loadUsers()
  }, [open, isManager])

  const handleSubmit = async () => {
    const nextErrors: Record<string, string> = {}
    if (!draft.name.trim()) nextErrors.name = "Name is required."
    if (!/^\d{8,15}$/.test(draft.telephone.trim())) {
      nextErrors.telephone = "Telephone must contain 8 to 15 digits."
    }
    if (!draft.businessType.trim()) nextErrors.businessType = "Business type is required."
    if (!draft.businessLocation.trim()) {
      nextErrors.businessLocation = "Business location is required."
    }
    setErrors(nextErrors)
    if (Object.keys(nextErrors).length > 0) {
      return
    }

    setSaving(true)
    try {
      const payload: Record<string, unknown> = {
        name: draft.name.trim(),
        telephone: draft.telephone.trim(),
        email: draft.email.trim() || null,
        businessName: draft.businessName.trim() || null,
        businessType: draft.businessType.trim(),
        businessLocation: draft.businessLocation.trim(),
      }
      // Only managers can change assignment.
      if (isManager) {
        payload.assignedUserId =
          draft.assignedUserId === UNASSIGNED_VALUE ? null : draft.assignedUserId
      }
      const response = await fetch(`/api/leads/${leadId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      })
      const data = (await response.json()) as { lead?: MappedLead; error?: string }
      if (!response.ok || !data.lead) {
        throw new Error(data.error || "Unable to save lead.")
      }
      onSaved(data.lead)
      showToast("Lead updated.")
      onClose()
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Unable to save lead.", "error")
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => (!next ? onClose() : undefined)}>
      <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Edit lead</DialogTitle>
          <DialogDescription>Update the lead&apos;s contact and business details.</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-5">
          <Field>
            <FieldLabel htmlFor="edit-name">Name</FieldLabel>
            <Input
              id="edit-name"
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            />
            <FieldError errors={errors.name ? [{ message: errors.name }] : undefined} />
          </Field>
          <Field>
            <FieldLabel htmlFor="edit-telephone">Telephone</FieldLabel>
            <Input
              id="edit-telephone"
              value={draft.telephone}
              onChange={(e) => setDraft({ ...draft, telephone: e.target.value })}
            />
            <FieldError
              errors={errors.telephone ? [{ message: errors.telephone }] : undefined}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="edit-email">Email</FieldLabel>
            <Input
              id="edit-email"
              type="email"
              value={draft.email}
              onChange={(e) => setDraft({ ...draft, email: e.target.value })}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="edit-business-name">Business name</FieldLabel>
            <Input
              id="edit-business-name"
              value={draft.businessName}
              onChange={(e) => setDraft({ ...draft, businessName: e.target.value })}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="edit-business-type">Business type</FieldLabel>
            <Input
              id="edit-business-type"
              value={draft.businessType}
              onChange={(e) => setDraft({ ...draft, businessType: e.target.value })}
            />
            <FieldError
              errors={errors.businessType ? [{ message: errors.businessType }] : undefined}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="edit-business-location">Business location</FieldLabel>
            <Input
              id="edit-business-location"
              value={draft.businessLocation}
              onChange={(e) => setDraft({ ...draft, businessLocation: e.target.value })}
            />
            <FieldError
              errors={
                errors.businessLocation
                  ? [{ message: errors.businessLocation }]
                  : undefined
              }
            />
          </Field>
          {/* Source is read-only */}
          <Field>
            <FieldLabel>Source</FieldLabel>
            <Input value={lead.source ?? "--"} disabled readOnly className="capitalize" />
          </Field>
          {isManager ? (
            <Field>
              <FieldLabel>Assigned to</FieldLabel>
              <Select
                value={draft.assignedUserId}
                onValueChange={(value) => setDraft({ ...draft, assignedUserId: value })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={UNASSIGNED_VALUE}>Unassigned</SelectItem>
                  {assignableUsers.map((agent) => (
                    <SelectItem key={agent.id} value={agent.id}>
                      {agent.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          ) : null}
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button type="button" onClick={() => void handleSubmit()} disabled={saving}>
            {saving ? "Saving..." : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
