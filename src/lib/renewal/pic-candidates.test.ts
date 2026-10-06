import assert from "node:assert/strict"
import test from "node:test"

import { buildPicCandidates } from "./pic-candidates.ts"
import type { RenewalContact, RenewalMapping } from "./pic-resolution.ts"

function contact(id: string, overrides: Partial<RenewalContact> = {}): RenewalContact {
  return { contactId: id, name: `Contact ${id}`, email: null, primaryPhone: null, channels: [], ...overrides }
}

const contacts = new Map<string, RenewalContact>([
  ["1", contact("1", { name: "Zara", email: "zara@merchant.my", channels: [{ channel: "email", isEnabled: true }] })],
  ["2", contact("2", { name: "Amin", email: "amin@merchant.my", channels: [{ channel: "email", isEnabled: false }] })],
  ["3", contact("3", { name: "Bala", primaryPhone: "0162207781", channels: [{ channel: "whatsapp", isEnabled: true }] })],
  ["4", contact("4", { name: "Chen", email: "chen@merchant.my", channels: [{ channel: "email", isEnabled: true }] })],
])

const mappings: RenewalMapping[] = [
  { mappingId: "10", contactId: "1", franchiseId: "11007", outletId: null, isRenewalPic: false, isRenewalCc: true },
  { mappingId: "11", contactId: "2", franchiseId: "11007", outletId: "24131", isRenewalPic: false, isRenewalCc: false },
  { mappingId: "12", contactId: "3", franchiseId: "11007", outletId: "24131", isRenewalPic: false, isRenewalCc: false },
  // Mapped to a different outlet: not a candidate for 24131.
  { mappingId: "13", contactId: "4", franchiseId: "11007", outletId: "24132", isRenewalPic: false, isRenewalCc: false },
]

test("candidates are this outlet's contacts and the franchise-wide ones", () => {
  const candidates = buildPicCandidates({ mappings, contacts }, "24131")
  assert.deepEqual(
    candidates.map((candidate) => [candidate.name, candidate.scope]),
    [
      ["Bala", "outlet"],
      ["Zara", "franchise"],
      // Unreachable last: no enabled channel with an address.
      ["Amin", "outlet"],
    ]
  )
  assert.deepEqual(candidates[0].usable, ["whatsapp"])
  assert.equal(candidates[1].isRenewalCc, true)
  assert.deepEqual(candidates[2].usable, [])
})

test("a franchise-level gap only offers franchise-wide contacts", () => {
  assert.deepEqual(
    buildPicCandidates({ mappings, contacts }, null).map((candidate) => candidate.mappingId),
    ["10"]
  )
})

test("a mapping without its row id cannot be designated, so it is not offered", () => {
  const withoutId = mappings.map((mapping) => ({ ...mapping, mappingId: undefined }))
  assert.deepEqual(buildPicCandidates({ mappings: withoutId, contacts }, "24131"), [])
})
