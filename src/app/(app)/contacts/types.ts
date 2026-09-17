export type ContactPhone = {
  id: string
  phone: string
  isPrimary: boolean
}

export type ContactSource = "staff" | "respond_io"

export type Contact = {
  id: string
  name: string
  email: string
  role: string | null
  source: ContactSource
  respondioContactId: string | null
  phones: ContactPhone[]
  mappingCount: number
  createdAt: string
  updatedAt: string
}

export type ContactMappingRow = {
  id: string
  franchiseId: string
  /** `null` means the contact represents every outlet under `franchiseId`. */
  outletId: string | null
  franchiseName: string | null
  outletName: string | null
  /** Accountable for this scope's renewal. At most one per franchise-and-outlet. */
  isRenewalPic: boolean
  /** Copied on the same reminders and receipts as the PIC, on their own channels. */
  isRenewalCc: boolean
}

/** A contact whose phone or email collides with one being created or edited. */
export type DuplicateMatch = {
  contactId: string
  name: string
  role: string | null
  matchedOn: "email" | "phone"
  matchedValue: string
}

export type ContactFilterOptions = {
  roles: string[]
  franchises: { id: string; name: string }[]
  outlets: { id: string; franchiseId: string; name: string }[]
}
