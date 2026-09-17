import assert from "node:assert/strict"
import test from "node:test"

import {
  decideSubscriptionSync,
  normalizePosValidUntil,
  simsOwnsValidUntil,
} from "./subscription-sync.ts"
import type {
  ExistingSubscription,
  PosOutletSnapshot,
} from "./subscription-sync.ts"

function snapshot(overrides: Partial<PosOutletSnapshot> = {}): PosOutletSnapshot {
  return {
    franchiseId: "501",
    outletId: "3",
    companyName: "Kedai Kopi Sdn Bhd",
    outletName: "Outlet Three",
    centralId: null,
    status: "Active",
    validUntil: "2026-10-15 00:00:00.000",
    ...overrides,
  }
}

function existing(
  overrides: Partial<ExistingSubscription> = {}
): ExistingSubscription {
  return {
    id: "7",
    companyName: "Kedai Kopi Sdn Bhd",
    outletName: "Outlet Three",
    centralId: null,
    status: "Active",
    validUntil: "2026-10-15 00:00:00.000",
    validUntilSource: "pos_seed",
    lastExtendedAt: null,
    posValidUntil: "2026-10-15 00:00:00.000",
    isActive: true,
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// Normalisation
// ---------------------------------------------------------------------------

test("reads a naive POS timestamp as UTC, matching every other reader", () => {
  // parseDate in dates.ts appends Z to a timestamp with no offset. Diverging
  // here would shift these outlets by eight hours against the rest of SIMS.
  assert.equal(
    normalizePosValidUntil("2026-10-15 23:59:59"),
    "2026-10-15 23:59:59.000"
  )
  assert.equal(
    normalizePosValidUntil("2026-10-15T23:59:59"),
    "2026-10-15 23:59:59.000"
  )
})

test("honours an explicit offset rather than assuming UTC", () => {
  // 08:00 in Kuala Lumpur is midnight UTC the same day.
  assert.equal(
    normalizePosValidUntil("2026-10-15T08:00:00+08:00"),
    "2026-10-15 00:00:00.000"
  )
  assert.equal(
    normalizePosValidUntil("2026-10-15T08:00:00+0800"),
    "2026-10-15 00:00:00.000"
  )
})

test("accepts a date with no time as UTC midnight", () => {
  assert.equal(normalizePosValidUntil("2026-10-15"), "2026-10-15 00:00:00.000")
})

test("returns null for anything it cannot read", () => {
  assert.equal(normalizePosValidUntil(null), null)
  assert.equal(normalizePosValidUntil(undefined), null)
  assert.equal(normalizePosValidUntil(""), null)
  assert.equal(normalizePosValidUntil("   "), null)
  assert.equal(normalizePosValidUntil("not a date"), null)
  assert.equal(normalizePosValidUntil(20261015), null)
})

// ---------------------------------------------------------------------------
// Ownership
// ---------------------------------------------------------------------------

test("POS still owns the date before any renewal", () => {
  assert.equal(simsOwnsValidUntil(existing()), false)
})

test("SIMS owns the date once an extension has been applied", () => {
  assert.equal(
    simsOwnsValidUntil(
      existing({
        validUntilSource: "sims_extension",
        lastExtendedAt: "2026-10-22 03:14:00.000",
      })
    ),
    true
  )
})

test("a hand-corrected date is still POS-tracked until a renewal lands", () => {
  // The source enum says where the value came from; lastExtendedAt is the fact
  // that a renewal happened. Only the latter transfers ownership.
  assert.equal(
    simsOwnsValidUntil(existing({ validUntilSource: "manual" })),
    false
  )
})

// ---------------------------------------------------------------------------
// Decisions
// ---------------------------------------------------------------------------

test("an outlet never seen before is inserted", () => {
  const decision = decideSubscriptionSync(snapshot(), null)
  assert.equal(decision.action, "insert")
})

test("an unchanged outlet writes nothing", () => {
  const decision = decideSubscriptionSync(snapshot(), existing())
  assert.equal(decision.action, "unchanged")
  assert.equal(decision.action === "unchanged" ? decision.drift : "x", null)
})

test("identity changes always follow POS", () => {
  const decision = decideSubscriptionSync(
    snapshot({ outletName: "Outlet Three (Relocated)", status: "Inactive" }),
    existing()
  )

  assert.equal(decision.action, "update")
  if (decision.action !== "update") return
  assert.equal(decision.changes.outletName, "Outlet Three (Relocated)")
  assert.equal(decision.changes.status, "Inactive")
})

test("a POS correction flows through before any renewal", () => {
  const decision = decideSubscriptionSync(
    snapshot({ validUntil: "2026-11-30 00:00:00.000" }),
    existing()
  )

  assert.equal(decision.action, "update")
  if (decision.action !== "update") return
  assert.equal(decision.changes.validUntil, "2026-11-30 00:00:00.000")
  assert.equal(decision.changes.validUntilSource, "pos_seed")
  assert.equal(decision.drift, null)
})

test("the import never overwrites a date SIMS extended", () => {
  // This is the whole point of the module. The import still reports
  // 2026-10-15; SIMS has moved to 2027-10-15 on a confirmed payment and the
  // POS push has not landed yet. Taking the POS value would silently undo a
  // renewal the merchant paid for.
  const renewed = existing({
    validUntil: "2027-10-15 00:00:00.000",
    validUntilSource: "sims_extension",
    lastExtendedAt: "2026-10-22 03:14:00.000",
    // Not yet recorded, so this pass has something to write and the decision
    // is an update rather than a no-op.
    posValidUntil: null,
  })

  const decision = decideSubscriptionSync(snapshot(), renewed)

  assert.equal(decision.action, "update")
  if (decision.action !== "update") return
  assert.equal(decision.changes.validUntil, undefined)
  assert.equal(decision.changes.validUntilSource, undefined)
  // The POS value is still recorded, because that is what makes drift visible.
  assert.equal(decision.changes.posValidUntil, "2026-10-15 00:00:00.000")
  assert.equal(decision.drift, null)
})

test("a SIMS-owned date with nothing else changed is a clean no-op", () => {
  const renewed = existing({
    validUntil: "2027-10-15 00:00:00.000",
    validUntilSource: "sims_extension",
    lastExtendedAt: "2026-10-22 03:14:00.000",
  })

  // The import still reports 2026-10-15 and has already recorded it, so there
  // is genuinely nothing to write. The extended date survives untouched.
  const decision = decideSubscriptionSync(snapshot(), renewed)
  assert.equal(decision.action, "unchanged")
  assert.equal(decision.action === "unchanged" ? decision.drift : "x", null)
})

test("POS running ahead of an extended date is reported as drift", () => {
  // Somebody renewed this outlet outside SIMS. Neither value is safely
  // discardable, so a person decides.
  const renewed = existing({
    validUntil: "2027-10-15 00:00:00.000",
    validUntilSource: "sims_extension",
    lastExtendedAt: "2026-10-22 03:14:00.000",
  })

  const decision = decideSubscriptionSync(
    snapshot({ validUntil: "2028-01-01 00:00:00.000" }),
    renewed
  )

  const drift = decision.action === "update" ? decision.drift : null
  assert.notEqual(drift, null)
  assert.deepEqual(drift, {
    franchiseId: "501",
    outletId: "3",
    simsValidUntil: "2027-10-15 00:00:00.000",
    posValidUntil: "2028-01-01 00:00:00.000",
  })
  // Drift is reported, not applied.
  assert.equal(
    decision.action === "update" ? decision.changes.validUntil : "x",
    undefined
  )
})

test("a null POS date never erases a date SIMS holds", () => {
  const renewed = existing({
    validUntil: "2027-10-15 00:00:00.000",
    validUntilSource: "sims_extension",
    lastExtendedAt: "2026-10-22 03:14:00.000",
  })

  const decision = decideSubscriptionSync(
    snapshot({ validUntil: null }),
    renewed
  )

  assert.equal(
    decision.action === "update" ? decision.changes.validUntil : "x",
    undefined
  )
  assert.equal(decision.action === "update" ? decision.drift : "x", null)
})

test("a null central id from POS does not erase one SIMS learned elsewhere", () => {
  // The renewal workbook is the expected source of central ids; POS does not
  // carry them today.
  const withCentralId = existing({ centralId: "C-0042" })
  const decision = decideSubscriptionSync(
    snapshot({ centralId: null }),
    withCentralId
  )
  assert.equal(decision.action, "unchanged")
})

test("a central id from POS fills a gap", () => {
  const decision = decideSubscriptionSync(
    snapshot({ centralId: "C-0042" }),
    existing()
  )
  assert.equal(
    decision.action === "update" ? decision.changes.centralId : null,
    "C-0042"
  )
})
