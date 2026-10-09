import assert from "node:assert/strict"
import test from "node:test"

import { decidePayment, parseGatewayNotice } from "./payment-confirmation-rules.ts"
import type { GatewayNotice, InvoiceFacts, SessionFacts } from "./payment-confirmation-rules.ts"

function notice(overrides: Partial<GatewayNotice> = {}): GatewayNotice {
  return {
    referenceCode: "PI-2026-09-014-1",
    status: 1,
    amount: 840000,
    currencyCode: "MYR",
    transactionNumber: "2005671137F81FD81D89D8",
    paymentSessionNumber: "2037D293E60AEB67B59251030",
    providerTransactionNumber: null,
    ...overrides,
  }
}

const session: SessionFacts = { status: "payment_pending", amountMinor: 840000, currencyCode: "MYR" }
const invoice: InvoiceFacts = { status: "payment_pending", totalMinor: 840000 }

test("a callback body needs a reference code and an integer status", () => {
  assert.equal(parseGatewayNotice(null), null)
  assert.equal(parseGatewayNotice({ status: 1 }), null)
  assert.equal(parseGatewayNotice({ referenceCode: "x", status: "paid" }), null)
  const parsed = parseGatewayNotice({
    referenceCode: " PI-2026-09-014-1 ",
    status: "1",
    amount: "840000",
    currencyCode: "myr",
    transactionNumber: "T1",
  })
  assert.deepEqual(parsed, {
    referenceCode: "PI-2026-09-014-1",
    status: 1,
    amount: 840000,
    currencyCode: "MYR",
    transactionNumber: "T1",
    paymentSessionNumber: null,
    providerTransactionNumber: null,
  })
})

test("status 1 with matching amount, currency and invoice total confirms", () => {
  assert.deepEqual(decidePayment({ notice: notice(), session, invoice }), { kind: "confirm", state: "paid" })
})

test("authorised is not paid", () => {
  const decision = decidePayment({ notice: notice({ status: 9 }), session, invoice })
  assert.equal(decision.kind, "ignore")
  assert.equal((decision as { state: string }).state, "authorized")
})

test("a replayed callback on a paid session is a duplicate", () => {
  assert.deepEqual(decidePayment({ notice: notice(), session: { ...session, status: "paid" }, invoice }), {
    kind: "duplicate",
  })
})

test("a second payment on a paid invoice is an overpayment, never a second extension", () => {
  const decision = decidePayment({
    notice: notice({ referenceCode: "PI-2026-09-014-2" }),
    session: { ...session, status: "superseded" },
    invoice: { ...invoice, status: "paid" },
  })
  assert.equal(decision.kind, "overpayment")
})

test("the wrong currency or the wrong amount is a mismatch, not a payment", () => {
  assert.equal(decidePayment({ notice: notice({ currencyCode: "SGD" }), session, invoice }).kind, "amount_mismatch")
  assert.equal(decidePayment({ notice: notice({ amount: 490000 }), session, invoice }).kind, "amount_mismatch")
})

test("a superseded session paid after a term change is a mismatch against the invoice", () => {
  const decision = decidePayment({
    notice: notice(),
    session: { ...session, status: "superseded" },
    invoice: { ...invoice, totalMinor: 490000 },
  })
  assert.equal(decision.kind, "amount_mismatch")
  assert.match((decision as { detail: string }).detail, /8400\.00.*4900\.00/)
})

test("a superseded session paid for the amount the invoice still totals confirms", () => {
  assert.equal(
    decidePayment({ notice: notice(), session: { ...session, status: "superseded" }, invoice }).kind,
    "confirm"
  )
})

test("a body without an amount trusts the session's own amount", () => {
  assert.equal(decidePayment({ notice: notice({ amount: null, currencyCode: null }), session, invoice }).kind, "confirm")
})

test("failed, cancelled and expired close an open session and are ignored on a closed one", () => {
  assert.deepEqual(decidePayment({ notice: notice({ status: 2 }), session, invoice }), {
    kind: "session_closed",
    sessionStatus: "failed",
  })
  assert.deepEqual(decidePayment({ notice: notice({ status: 8 }), session, invoice }), {
    kind: "session_closed",
    sessionStatus: "cancelled",
  })
  assert.deepEqual(decidePayment({ notice: notice({ status: 10 }), session, invoice }), {
    kind: "session_closed",
    sessionStatus: "expired",
  })
  assert.equal(
    decidePayment({ notice: notice({ status: 2 }), session: { ...session, status: "superseded" }, invoice }).kind,
    "ignore"
  )
})

test("a refund is handed to a person", () => {
  assert.deepEqual(decidePayment({ notice: notice({ status: 11 }), session: { ...session, status: "paid" }, invoice }), {
    kind: "refunded",
  })
})

test("an unknown status code is ignored and named", () => {
  const decision = decidePayment({ notice: notice({ status: 42 }), session, invoice })
  assert.equal(decision.kind, "ignore")
  assert.match((decision as { note: string }).note, /42/)
})
