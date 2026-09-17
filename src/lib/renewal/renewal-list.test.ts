import assert from "node:assert/strict"
import test from "node:test"

import {
  deriveOutletState,
  expiryMonths,
  matchesFilters,
  rollUpState,
  summarisePlans,
} from "./renewal-list.ts"
import type { OutletFacts } from "./renewal-list.ts"

const today = "2026-09-17"

function facts(overrides: Partial<OutletFacts> = {}): OutletFacts {
  return {
    validUntilDate: "2026-10-02",
    billedBy: "slurp",
    billingHold: false,
    hasBlockingAction: false,
    invoiceStatus: null,
    reminderSent: false,
    extended: false,
    ...overrides,
  }
}

test("nothing due and nothing wrong is not due", () => {
  assert.equal(deriveOutletState(facts(), today), "not_due")
})

test("an invoice that exists but was never dispatched reads as raised, not sent", () => {
  // Dispatch is not built yet. Saying "reminder sent" would be a lie the
  // list tells on the module's behalf.
  assert.equal(deriveOutletState(facts({ invoiceStatus: "issued" }), today), "invoiced")
  assert.equal(
    deriveOutletState(facts({ invoiceStatus: "sent", reminderSent: true }), today),
    "reminder_sent"
  )
})

test("a session at the gateway is awaiting payment", () => {
  assert.equal(deriveOutletState(facts({ invoiceStatus: "payment_pending" }), today), "awaiting_payment")
})

test("paid beats everything except reseller and hold", () => {
  assert.equal(deriveOutletState(facts({ invoiceStatus: "paid", hasBlockingAction: true }), today), "renewed")
  assert.equal(
    deriveOutletState(facts({ invoiceStatus: "paid", validUntilDate: "2026-08-01" }), today),
    "renewed"
  )
})

test("a blocking Actions Required entry wins over an invoice", () => {
  assert.equal(
    deriveOutletState(facts({ invoiceStatus: "issued", hasBlockingAction: true }), today),
    "action_required"
  )
})

test("expired and unpaid is non-renewed, even with an open invoice", () => {
  assert.equal(
    deriveOutletState(facts({ validUntilDate: "2026-09-01", invoiceStatus: "sent" }), today),
    "non_renewed"
  )
})

test("reseller-billed and billing hold are recognised before anything else", () => {
  assert.equal(deriveOutletState(facts({ billedBy: "reseller", invoiceStatus: "paid" }), today), "reseller")
  assert.equal(deriveOutletState(facts({ billingHold: true, invoiceStatus: "paid" }), today), "on_hold")
})

test("a voided or draft invoice does not make an outlet look invoiced", () => {
  assert.equal(deriveOutletState(facts({ invoiceStatus: "cancelled" }), today), "not_due")
  assert.equal(deriveOutletState(facts({ invoiceStatus: "draft" }), today), "not_due")
})

test("a franchise carries its most urgent outlet", () => {
  assert.equal(rollUpState(["not_due", "invoiced", "action_required"]), "action_required")
  assert.equal(rollUpState(["invoiced", "awaiting_payment"]), "awaiting_payment")
  assert.equal(rollUpState(["renewed", "renewed"]), "renewed")
  // One renewed outlet does not make the franchise renewed.
  assert.equal(rollUpState(["renewed", "invoiced"]), "invoiced")
  assert.equal(rollUpState(["reseller", "reseller"]), "reseller")
  assert.equal(rollUpState(["reseller", "not_due"]), "not_due")
  assert.equal(rollUpState([]), "not_due")
})

test("plans are summarised by count, most common first", () => {
  assert.equal(
    summarisePlans(["Essential Standard", "Meal Standard", "Essential Standard", "Essential Standard"]),
    "Essential Standard ×3, Meal Standard"
  )
  assert.equal(summarisePlans([null, null]), "No plan resolves")
  assert.equal(summarisePlans(["Essential Standard", null]), "Essential Standard, 1 without a plan")
})

const franchise = {
  franchiseId: "11007",
  name: "Teh Tarik House",
  fid: "11007",
  state: "invoiced" as const,
  validUntilDate: "2026-10-02",
  outlets: [
    { name: "Mid Valley", outletId: "24118", openCount: 2, hasInvoice: true },
    { name: "Bangsar", outletId: "24122", openCount: 0, hasInvoice: true },
  ],
}

test("search matches franchise name, ids and outlet names, case-insensitively", () => {
  const base = { search: "", state: "all" as const, month: "all", opened: "all" as const }
  assert.equal(matchesFilters(franchise, { ...base, search: "teh tarik" }), true)
  assert.equal(matchesFilters(franchise, { ...base, search: "11007" }), true)
  assert.equal(matchesFilters(franchise, { ...base, search: "bangsar" }), true)
  assert.equal(matchesFilters(franchise, { ...base, search: "24122" }), true)
  assert.equal(matchesFilters(franchise, { ...base, search: "kopitiam" }), false)
})

test("state, month and opened filters narrow the list", () => {
  const base = { search: "", state: "all" as const, month: "all", opened: "all" as const }
  assert.equal(matchesFilters(franchise, { ...base, state: "invoiced" }), true)
  assert.equal(matchesFilters(franchise, { ...base, state: "renewed" }), false)
  assert.equal(matchesFilters(franchise, { ...base, month: "2026-10" }), true)
  assert.equal(matchesFilters(franchise, { ...base, month: "2026-09" }), false)
  assert.equal(matchesFilters(franchise, { ...base, opened: "opened" }), true)
  // "Never opened" means an invoiced outlet with no open, which Bangsar is.
  assert.equal(matchesFilters(franchise, { ...base, opened: "never" }), true)
  assert.equal(
    matchesFilters({ ...franchise, outlets: [franchise.outlets[0]] }, { ...base, opened: "never" }),
    false
  )
})

test("expiry months are distinct and ascending", () => {
  assert.deepEqual(expiryMonths(["2026-10-02", "2026-09-30", null, "2026-10-15"]), ["2026-09", "2026-10"])
})
