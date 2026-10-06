import assert from "node:assert/strict"
import test from "node:test"

import { decidePicMapping } from "./pic-mapping.ts"

const outlet = { franchiseId: "10688", outletId: "23904" }
const franchise = { franchiseId: "10688", outletId: null }

test("a new contact, or one mapped elsewhere, gets a mapping added at the chosen scope", () => {
  assert.deepEqual(decidePicMapping([], outlet), { kind: "add", scope: "outlet" })
  assert.deepEqual(decidePicMapping([], franchise), { kind: "add", scope: "franchise" })
  const elsewhere = [{ id: "9", franchiseId: "11007", outletId: null }]
  assert.deepEqual(decidePicMapping(elsewhere, outlet), { kind: "add", scope: "outlet" })
})

test("an existing mapping at exactly this scope is reused, keeping its CC flag", () => {
  const existing = [{ id: "5", franchiseId: "10688", outletId: "23904", isRenewalCc: true }]
  assert.deepEqual(decidePicMapping(existing, outlet), { kind: "reuse", mappingId: "5", scope: "outlet", isRenewalCc: true })
})

test("a franchise-wide contact already covers the outlet, so that row is designated", () => {
  const existing = [{ id: "6", franchiseId: "10688", outletId: null }]
  assert.deepEqual(decidePicMapping(existing, outlet), { kind: "reuse", mappingId: "6", scope: "franchise", isRenewalCc: false })
})

test("going franchise-wide over a contact's outlet rows is refused, as on the Contacts page", () => {
  const existing = [{ id: "7", franchiseId: "10688", outletId: "23905", franchiseName: "Warung Padu" }]
  const decision = decidePicMapping(existing, franchise)
  assert.equal(decision.kind, "refuse")
  assert.match(decision.kind === "refuse" ? decision.message : "", /specific outlet/)
})
