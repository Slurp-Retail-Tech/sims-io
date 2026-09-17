import assert from "node:assert/strict"
import test from "node:test"

import {
  buildSignatureBase,
  normalizeEndpointUrl,
  signRequest,
  sortAndStripNulls,
  verifyCallbackSignature,
} from "./signature.ts"

const SECRET = "KPksB8uuh9ZW2VFg"
const URL = "https://staging-payments.commerce.asia/api/services/app/PaymentGateway/InitialSession"

// ---------------------------------------------------------------------------
// The signature base
//
// These pin the algorithm's own properties. The vendor's worked example is NOT
// used as a golden vector: its published hash cannot be reproduced from its
// published inputs under any of 160 combinations tried, and the example is
// internally inconsistent. See the module header.
//
// The algorithm itself was confirmed against the staging gateway on
// 17 September 2026 — three rival readings were refused with `Invalid
// Signature` and this one validated. These tests guard it from drifting away
// from that confirmed behaviour.
// ---------------------------------------------------------------------------

test("sorts properties ascending", () => {
  const base = buildSignatureBase(URL, {
    referenceCode: "abc",
    amount: 100,
    currencyCode: "MYR",
  })
  assert.ok(base.endsWith(`{"amount":100,"currencycode":"myr","referencecode":"abc"}`))
})

test("sorts nested objects too", () => {
  const base = buildSignatureBase(URL, {
    customer: { name: "aisyah", email: "a@b.com", mobileNo: "012" },
    amount: 100,
  })
  assert.ok(
    base.endsWith(
      `{"amount":100,"customer":{"email":"a@b.com","mobileno":"012","name":"aisyah"}}`
    )
  )
})

test("produces the same string regardless of the order keys were written in", () => {
  const a = buildSignatureBase(URL, { b: 2, a: 1, c: 3 })
  const b = buildSignatureBase(URL, { c: 3, a: 1, b: 2 })
  assert.equal(a, b)
})

test("omits null and undefined properties", () => {
  // CommercePay excludes them when validating, so including one produces a
  // signature that can never match.
  const base = buildSignatureBase(URL, {
    amount: 100,
    description: null,
    userAgent: undefined,
    referenceCode: "abc",
  })
  assert.ok(base.endsWith(`{"amount":100,"referencecode":"abc"}`))
})

test("omits nulls inside nested objects", () => {
  const base = buildSignatureBase(URL, {
    customer: { email: "a@b.com", mobileNo: null },
  })
  assert.ok(base.endsWith(`{"customer":{"email":"a@b.com"}}`))
})

test("keeps a false or zero value, which are not null", () => {
  const base = buildSignatureBase(URL, { flag: false, amount: 0 })
  assert.ok(base.endsWith(`{"amount":0,"flag":false}`))
})

test("preserves array order while sorting the objects inside it", () => {
  // Order is meaningful in an array; sorting one would change the payload's
  // meaning rather than its spelling.
  const base = buildSignatureBase(URL, {
    items: [
      { b: 2, a: 1 },
      { d: 4, c: 3 },
    ],
  })
  assert.ok(base.endsWith(`{"items":[{"a":1,"b":2},{"c":3,"d":4}]}`))
})

test("lower-cases the whole string, values included", () => {
  const base = buildSignatureBase(URL, { currencyCode: "MYR", name: "Aisyah" })
  assert.equal(base, base.toLowerCase())
  assert.ok(base.includes(`"myr"`))
  assert.ok(base.includes(`"aisyah"`))
  assert.ok(base.startsWith("https://staging-payments.commerce.asia/api/"))
})

test("drops the query string and any trailing slash from the URL", () => {
  assert.equal(normalizeEndpointUrl("https://x.test/api/Thing/"), "https://x.test/api/Thing")
  assert.equal(normalizeEndpointUrl("https://x.test/api/Thing///"), "https://x.test/api/Thing")
  assert.equal(
    normalizeEndpointUrl("https://x.test/api/Query?TransactionNumber=abc"),
    "https://x.test/api/Query"
  )
  assert.equal(normalizeEndpointUrl("https://x.test/api/Thing#frag"), "https://x.test/api/Thing")
})

test("a trailing slash does not change the signature", () => {
  const body = { amount: 100 }
  assert.equal(
    signRequest("https://x.test/api/Thing", body, SECRET),
    signRequest("https://x.test/api/Thing/", body, SECRET)
  )
})

// ---------------------------------------------------------------------------
// Signing
// ---------------------------------------------------------------------------

test("signs deterministically", () => {
  const body = { amount: 127200, currencyCode: "MYR", referenceCode: "PI-2026/09-014-1" }
  assert.equal(signRequest(URL, body, SECRET), signRequest(URL, body, SECRET))
})

test("returns a 64-character lowercase hex digest", () => {
  const signature = signRequest(URL, { amount: 100 }, SECRET)
  assert.match(signature, /^[0-9a-f]{64}$/)
})

test("a different amount produces a different signature", () => {
  // The guard that matters: a tampered amount must not verify.
  const a = signRequest(URL, { amount: 100 }, SECRET)
  const b = signRequest(URL, { amount: 10000 }, SECRET)
  assert.notEqual(a, b)
})

test("a different secret produces a different signature", () => {
  assert.notEqual(
    signRequest(URL, { amount: 100 }, SECRET),
    signRequest(URL, { amount: 100 }, "someOtherSecret")
  )
})

test("a different endpoint produces a different signature", () => {
  assert.notEqual(
    signRequest(`${URL}`, { amount: 100 }, SECRET),
    signRequest(`${URL}Two`, { amount: 100 }, SECRET)
  )
})

// ---------------------------------------------------------------------------
// Callback verification
// ---------------------------------------------------------------------------

const CALLBACK_URL = "https://sims.example.com/api/public/commercepay/callback"
const CALLBACK_BODY = {
  amount: 127200,
  channelId: 4,
  currencyCode: "MYR",
  referenceCode: "PI-2026/09-014-1",
  status: 1,
  transactionNumber: "2005671137F81FD81D89D8",
  paymentSessionNumber: "2037D293E60AEB67B59251030",
}

test("accepts a callback signed with the merchant secret", () => {
  const signature = signRequest(CALLBACK_URL, CALLBACK_BODY, SECRET)
  assert.equal(
    verifyCallbackSignature({
      callbackUrl: CALLBACK_URL,
      body: CALLBACK_BODY,
      presentedSignature: signature,
      secretKey: SECRET,
    }),
    true
  )
})

test("accepts a signature presented in upper case", () => {
  const signature = signRequest(CALLBACK_URL, CALLBACK_BODY, SECRET)
  assert.equal(
    verifyCallbackSignature({
      callbackUrl: CALLBACK_URL,
      body: CALLBACK_BODY,
      presentedSignature: signature.toUpperCase(),
      secretKey: SECRET,
    }),
    true
  )
})

test("rejects a callback whose amount was tampered with", () => {
  // This is the whole point: a forged callback must not mark an invoice paid.
  const signature = signRequest(CALLBACK_URL, CALLBACK_BODY, SECRET)
  assert.equal(
    verifyCallbackSignature({
      callbackUrl: CALLBACK_URL,
      body: { ...CALLBACK_BODY, amount: 1 },
      presentedSignature: signature,
      secretKey: SECRET,
    }),
    false
  )
})

test("rejects a callback signed with the wrong secret", () => {
  const signature = signRequest(CALLBACK_URL, CALLBACK_BODY, "attackerSecret")
  assert.equal(
    verifyCallbackSignature({
      callbackUrl: CALLBACK_URL,
      body: CALLBACK_BODY,
      presentedSignature: signature,
      secretKey: SECRET,
    }),
    false
  )
})

test("rejects a missing or empty signature without throwing", () => {
  for (const presented of [null, "", "   ", "not-hex", "abc"]) {
    assert.equal(
      verifyCallbackSignature({
        callbackUrl: CALLBACK_URL,
        body: CALLBACK_BODY,
        presentedSignature: presented,
        secretKey: SECRET,
      }),
      false
    )
  }
})

test("sortAndStripNulls leaves scalars alone", () => {
  assert.equal(sortAndStripNulls(5), 5)
  assert.equal(sortAndStripNulls("x"), "x")
  assert.equal(sortAndStripNulls(true), true)
})
