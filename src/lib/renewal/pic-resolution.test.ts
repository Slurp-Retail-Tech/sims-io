import assert from "node:assert/strict"
import test from "node:test"

import {
  isUsableEmail,
  resolveChannels,
  resolveGroupRenewalPic,
  resolveRenewalPic,
  toE164,
} from "./pic-resolution.ts"
import type { RenewalContact, RenewalMapping } from "./pic-resolution.ts"

function contact(overrides: Partial<RenewalContact> = {}): RenewalContact {
  return {
    contactId: "1",
    name: "Aisyah",
    email: "aisyah@kedaikopi.com",
    primaryPhone: "+60162207781",
    channels: [
      { channel: "whatsapp", isEnabled: true },
      { channel: "email", isEnabled: true },
    ],
    ...overrides,
  }
}

function mapping(overrides: Partial<RenewalMapping> = {}): RenewalMapping {
  return {
    contactId: "1",
    franchiseId: "501",
    outletId: null,
    isRenewalPic: false,
    isRenewalCc: false,
    ...overrides,
  }
}

function directory(...contacts: RenewalContact[]) {
  return new Map(contacts.map((entry) => [entry.contactId, entry]))
}

// ---------------------------------------------------------------------------
// E.164
// ---------------------------------------------------------------------------

test("swaps a Malaysian trunk zero for the country code", () => {
  assert.equal(toE164("0162207781"), "+60162207781")
  assert.equal(toE164("016-220 7781"), "+60162207781")
})

test("leaves a number already in international form alone", () => {
  assert.equal(toE164("+60162207781"), "+60162207781")
  assert.equal(toE164("60162207781"), "+60162207781")
  assert.equal(toE164("+60 16-220 7781"), "+60162207781")
})

test("does not prepend a country code to a number that already carries one", () => {
  // The bug this guards: 60... becoming 6060...
  assert.equal(toE164("60162207781"), "+60162207781")
})

test("honours a different country code", () => {
  assert.equal(toE164("0812345678", "62"), "+62812345678")
})

test("refuses anything too short or too long to be a number", () => {
  assert.equal(toE164("123"), null)
  assert.equal(toE164("6012345678901234567"), null)
})

test("returns null when there are no digits", () => {
  assert.equal(toE164(null), null)
  assert.equal(toE164(""), null)
  assert.equal(toE164("   "), null)
  assert.equal(toE164("not a phone"), null)
})

// ---------------------------------------------------------------------------
// Email
// ---------------------------------------------------------------------------

test("accepts an ordinary address", () => {
  assert.equal(isUsableEmail("aisyah@kedaikopi.com"), true)
  assert.equal(isUsableEmail("finance.team+renewals@getslurp.com.my"), true)
})

test("rejects an address nothing could be delivered to", () => {
  assert.equal(isUsableEmail(null), false)
  assert.equal(isUsableEmail(""), false)
  // contacts.email is NOT NULL but may hold an empty string.
  assert.equal(isUsableEmail("   "), false)
  assert.equal(isUsableEmail("aisyah"), false)
  assert.equal(isUsableEmail("aisyah@localhost"), false)
  assert.equal(isUsableEmail("aisyah@@kedaikopi.com"), false)
  assert.equal(isUsableEmail("ais yah@kedaikopi.com"), false)
})

// ---------------------------------------------------------------------------
// Channels
// ---------------------------------------------------------------------------

test("a contact with both channels enabled is reachable on both", () => {
  const { usable, unusable } = resolveChannels(contact())
  assert.deepEqual(usable, [
    { channel: "whatsapp", address: "+60162207781" },
    { channel: "email", address: "aisyah@kedaikopi.com" },
  ])
  assert.deepEqual(unusable, [])
})

test("a disabled channel is neither used nor reported as a gap", () => {
  // The contact has not asked to be reached that way, so its absence is not a
  // problem to raise.
  const emailOnly = contact({
    channels: [
      { channel: "whatsapp", isEnabled: false },
      { channel: "email", isEnabled: true },
    ],
    primaryPhone: null,
  })
  const { usable, unusable } = resolveChannels(emailOnly)
  assert.deepEqual(usable, [
    { channel: "email", address: "aisyah@kedaikopi.com" },
  ])
  assert.deepEqual(unusable, [])
})

test("an enabled channel missing its supporting field is reported", () => {
  const noPhone = contact({ primaryPhone: null })
  const { usable, unusable } = resolveChannels(noPhone)
  assert.deepEqual(usable, [
    { channel: "email", address: "aisyah@kedaikopi.com" },
  ])
  assert.deepEqual(unusable, ["whatsapp"])
})

// ---------------------------------------------------------------------------
// PIC resolution
// ---------------------------------------------------------------------------

test("an outlet with no designated PIC blocks, even with CC contacts", () => {
  // AC: a CC contact is never promoted. Nobody has been made accountable.
  const mappings = [mapping({ contactId: "2", isRenewalCc: true })]
  const result = resolveRenewalPic(
    mappings,
    directory(contact({ contactId: "2" })),
    "3"
  )
  assert.deepEqual(result, { status: "no_renewal_pic" })
})

test("a franchise-wide PIC covers every outlet", () => {
  const mappings = [mapping({ isRenewalPic: true })]
  const result = resolveRenewalPic(mappings, directory(contact()), "9")

  assert.equal(result.status, "resolved")
  if (result.status !== "resolved") return
  assert.equal(result.pic.contactId, "1")
  assert.equal(result.pic.source, "franchise")
})

test("an outlet-specific PIC beats the franchise-wide one", () => {
  const mappings = [
    mapping({ contactId: "1", isRenewalPic: true }),
    mapping({ contactId: "2", outletId: "3", isRenewalPic: true }),
  ]
  const contacts = directory(contact(), contact({ contactId: "2", name: "Rahim" }))

  const three = resolveRenewalPic(mappings, contacts, "3")
  assert.equal(three.status === "resolved" ? three.pic.contactId : null, "2")
  assert.equal(three.status === "resolved" ? three.pic.source : null, "outlet")

  const four = resolveRenewalPic(mappings, contacts, "4")
  assert.equal(four.status === "resolved" ? four.pic.contactId : null, "1")
  assert.equal(four.status === "resolved" ? four.pic.source : null, "franchise")
})

test("an outlet-specific mapping for another outlet does not leak across", () => {
  const mappings = [mapping({ outletId: "3", isRenewalPic: true })]
  assert.deepEqual(resolveRenewalPic(mappings, directory(contact()), "4"), {
    status: "no_renewal_pic",
  })
})

test("CC contacts from both scopes are included, each person once", () => {
  const mappings = [
    mapping({ contactId: "1", isRenewalPic: true }),
    mapping({ contactId: "2", isRenewalCc: true }),
    mapping({ contactId: "2", outletId: "3", isRenewalCc: true }),
    mapping({ contactId: "3", outletId: "3", isRenewalCc: true }),
  ]
  const contacts = directory(
    contact(),
    contact({ contactId: "2", name: "Head Office", email: "ho@kedaikopi.com" }),
    contact({ contactId: "3", name: "Outlet Manager", email: "om@kedaikopi.com" })
  )

  const result = resolveRenewalPic(mappings, contacts, "3")
  assert.equal(result.status, "resolved")
  if (result.status !== "resolved") return
  assert.deepEqual(
    result.ccs.map((cc) => cc.contactId).sort(),
    ["2", "3"]
  )
})

test("a contact designated neither PIC nor CC receives nothing", () => {
  const mappings = [
    mapping({ contactId: "1", isRenewalPic: true }),
    mapping({ contactId: "9" }),
  ]
  const contacts = directory(contact(), contact({ contactId: "9", name: "Support" }))

  const result = resolveRenewalPic(mappings, contacts, "3")
  assert.equal(result.status === "resolved" ? result.ccs.length : -1, 0)
})

test("the PIC is never also listed as their own CC", () => {
  const mappings = [mapping({ contactId: "1", isRenewalPic: true, isRenewalCc: true })]
  const result = resolveRenewalPic(mappings, directory(contact()), "3")
  assert.equal(result.status === "resolved" ? result.ccs.length : -1, 0)
})

test("a partly reachable PIC still gets the channel that works", () => {
  // Both enabled, no phone number: the email goes, WhatsApp is reported as
  // informational, and the invoice is NOT blocked.
  const mappings = [mapping({ isRenewalPic: true })]
  const result = resolveRenewalPic(
    mappings,
    directory(contact({ primaryPhone: null })),
    "3"
  )

  assert.equal(result.status, "resolved")
  if (result.status !== "resolved") return
  assert.deepEqual(
    result.pic.usable.map((channel) => channel.channel),
    ["email"]
  )
  assert.deepEqual(result.pic.unusable, ["whatsapp"])
})

test("a PIC with no usable channel at all blocks the invoice", () => {
  const mappings = [mapping({ isRenewalPic: true })]
  const unreachable = contact({
    primaryPhone: null,
    channels: [{ channel: "whatsapp", isEnabled: true }],
  })

  const result = resolveRenewalPic(mappings, directory(unreachable), "3")
  assert.equal(result.status, "unreachable_renewal_pic")
})

test("a PIC designated against a missing contact reads as no PIC", () => {
  const mappings = [mapping({ contactId: "404", isRenewalPic: true })]
  assert.deepEqual(resolveRenewalPic(mappings, directory(contact()), "3"), {
    status: "no_renewal_pic",
  })
})

// ---------------------------------------------------------------------------
// Grouped invoices
// ---------------------------------------------------------------------------

test("a group whose outlets share one PIC resolves to that person", () => {
  const mappings = [mapping({ isRenewalPic: true })]
  const result = resolveGroupRenewalPic(
    mappings,
    directory(contact()),
    ["3", "4", "5"]
  )
  assert.equal(result.status, "resolved")
  assert.equal(result.status === "resolved" ? result.pic.contactId : null, "1")
})

test("differing outlet PICs fall back to the franchise-wide PIC", () => {
  const mappings = [
    mapping({ contactId: "1", isRenewalPic: true }),
    mapping({ contactId: "2", outletId: "3", isRenewalPic: true }),
    mapping({ contactId: "3", outletId: "4", isRenewalPic: true }),
  ]
  const contacts = directory(
    contact({ contactId: "1", name: "Franchise Head" }),
    contact({ contactId: "2", name: "Manager Three" }),
    contact({ contactId: "3", name: "Manager Four" })
  )

  const result = resolveGroupRenewalPic(mappings, contacts, ["3", "4"])
  assert.equal(result.status, "resolved")
  assert.equal(result.status === "resolved" ? result.pic.contactId : null, "1")
})

test("differing PICs with no franchise-wide one are ambiguous, not guessed", () => {
  // SIMS does not choose which of two accountable people receives an invoice
  // covering outlets that are not all theirs.
  const mappings = [
    mapping({ contactId: "2", outletId: "3", isRenewalPic: true }),
    mapping({ contactId: "3", outletId: "4", isRenewalPic: true }),
  ]
  const contacts = directory(
    contact({ contactId: "2", name: "Manager Three" }),
    contact({ contactId: "3", name: "Manager Four" })
  )

  const result = resolveGroupRenewalPic(mappings, contacts, ["3", "4"])
  assert.equal(result.status, "ambiguous_renewal_pic")
  assert.deepEqual(
    result.status === "ambiguous_renewal_pic" ? result.contactIds : [],
    ["2", "3"]
  )
})

test("a group with nobody designated anywhere reports no PIC", () => {
  const result = resolveGroupRenewalPic([], directory(contact()), ["3", "4"])
  assert.deepEqual(result, { status: "no_renewal_pic" })
})

test("an empty group reports no PIC rather than throwing", () => {
  const mappings = [mapping({ isRenewalPic: true })]
  assert.deepEqual(resolveGroupRenewalPic(mappings, directory(contact()), []), {
    status: "no_renewal_pic",
  })
})

test("a group CC mapped to an outlet outside the group is not copied in", () => {
  const mappings = [
    mapping({ contactId: "1", isRenewalPic: true }),
    mapping({ contactId: "2", outletId: "9", isRenewalCc: true }),
  ]
  const contacts = directory(contact(), contact({ contactId: "2", name: "Other" }))

  const result = resolveGroupRenewalPic(mappings, contacts, ["3", "4"])
  assert.equal(result.status === "resolved" ? result.ccs.length : -1, 0)
})

test("an unreachable group PIC blocks the grouped invoice", () => {
  const mappings = [mapping({ isRenewalPic: true })]
  const unreachable = contact({
    email: "",
    channels: [{ channel: "email", isEnabled: true }],
  })
  const result = resolveGroupRenewalPic(mappings, directory(unreachable), ["3", "4"])
  assert.equal(result.status, "unreachable_renewal_pic")
})
