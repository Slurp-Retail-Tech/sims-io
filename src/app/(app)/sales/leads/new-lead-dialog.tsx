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

const BUSINESS_TYPES = [
  "Restaurant",
  "Cafe",
  "Bar",
  "Food Truck",
  "Diner",
  "Fine Dining",
  "Retail",
  "Enterprise / Multi-outlet",
]

const UNASSIGNED_VALUE = "__unassigned__"

type NewLeadDialogProps = {
  open: boolean
  isManager: boolean
  onClose: () => void
  onCreated: () => void
}

export function NewLeadDialog({ open, isManager, onClose, onCreated }: NewLeadDialogProps) {
  const { showToast } = useToast()
  const [name, setName] = React.useState("")
  const [telephone, setTelephone] = React.useState("")
  const [businessType, setBusinessType] = React.useState("")
  const [businessLocation, setBusinessLocation] = React.useState("")
  const [email, setEmail] = React.useState("")
  const [businessName, setBusinessName] = React.useState("")
  const [assignedUserId, setAssignedUserId] = React.useState(UNASSIGNED_VALUE)
  const [assignableUsers, setAssignableUsers] = React.useState<AssignableUser[]>([])
  const [errors, setErrors] = React.useState<Record<string, string>>({})
  const [submitting, setSubmitting] = React.useState(false)

  React.useEffect(() => {
    if (!open) {
      return
    }
    setName("")
    setTelephone("")
    setBusinessType("")
    setBusinessLocation("")
    setEmail("")
    setBusinessName("")
    setAssignedUserId(UNASSIGNED_VALUE)
    setErrors({})
  }, [open])

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
        // Assignment is optional; ignore load failures.
      }
    }
    void loadUsers()
  }, [open, isManager])

  const handleSubmit = async () => {
    const nextErrors: Record<string, string> = {}
    if (!name.trim()) nextErrors.name = "Name is required."
    if (!/^\d{8,15}$/.test(telephone.trim())) {
      nextErrors.telephone = "Telephone must contain 8 to 15 digits."
    }
    if (!businessType) nextErrors.businessType = "Business type is required."
    if (!businessLocation.trim()) nextErrors.businessLocation = "Business location is required."
    setErrors(nextErrors)
    if (Object.keys(nextErrors).length > 0) {
      return
    }

    setSubmitting(true)
    try {
      const response = await fetch("/api/leads/manual", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          telephone: telephone.trim(),
          businessType,
          businessLocation: businessLocation.trim(),
          email: email.trim() || null,
          businessName: businessName.trim() || null,
          assignedUserId:
            isManager && assignedUserId !== UNASSIGNED_VALUE ? assignedUserId : null,
        }),
      })
      const data = (await response.json()) as { lead?: MappedLead; error?: string }
      if (!response.ok || !data.lead) {
        throw new Error(data.error || "Unable to create lead.")
      }
      showToast("Lead created.")
      onCreated()
      onClose()
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Unable to create lead.", "error")
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => (!next ? onClose() : undefined)}>
      <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>New lead</DialogTitle>
          <DialogDescription>
            Manually create a lead. It will be labelled with the source “manual”.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-5">
          <Field>
            <FieldLabel htmlFor="lead-name">Name</FieldLabel>
            <Input id="lead-name" value={name} onChange={(e) => setName(e.target.value)} />
            <FieldError errors={errors.name ? [{ message: errors.name }] : undefined} />
          </Field>
          <Field>
            <FieldLabel htmlFor="lead-telephone">Telephone</FieldLabel>
            <Input
              id="lead-telephone"
              inputMode="numeric"
              value={telephone}
              onChange={(e) => setTelephone(e.target.value)}
            />
            <FieldError errors={errors.telephone ? [{ message: errors.telephone }] : undefined} />
          </Field>
          <Field>
            <FieldLabel>Business type</FieldLabel>
            <Select value={businessType} onValueChange={setBusinessType}>
              <SelectTrigger>
                <SelectValue placeholder="Select a business type" />
              </SelectTrigger>
              <SelectContent>
                {BUSINESS_TYPES.map((option) => (
                  <SelectItem key={option} value={option}>
                    {option}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <FieldError errors={errors.businessType ? [{ message: errors.businessType }] : undefined} />
          </Field>
          <Field>
            <FieldLabel htmlFor="lead-location">Business location</FieldLabel>
            <Input
              id="lead-location"
              value={businessLocation}
              onChange={(e) => setBusinessLocation(e.target.value)}
            />
            <FieldError
              errors={errors.businessLocation ? [{ message: errors.businessLocation }] : undefined}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="lead-email">Email (optional)</FieldLabel>
            <Input
              id="lead-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="lead-business-name">Business name (optional)</FieldLabel>
            <Input
              id="lead-business-name"
              value={businessName}
              onChange={(e) => setBusinessName(e.target.value)}
            />
          </Field>
          {isManager ? (
            <Field>
              <FieldLabel>Assign to (optional)</FieldLabel>
              <Select value={assignedUserId} onValueChange={setAssignedUserId}>
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
          <Button type="button" variant="outline" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button type="button" onClick={() => void handleSubmit()} disabled={submitting}>
            {submitting ? "Creating..." : "Create lead"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
