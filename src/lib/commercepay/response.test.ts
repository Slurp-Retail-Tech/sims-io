import assert from "node:assert/strict"
import test from "node:test"

import {
  isRetryable,
  isTransactionNotFound,
  readCommercePayResponse,
  TRANSACTION_ERROR_CODES,
} from "./response.ts"

/**
 * The two bodies below were captured verbatim from the staging gateway on
 * 17 September 2026 by scripts/verify-commercepay-signature.mjs. Both arrived
 * with HTTP 400, which the documentation says should be 500 for the second.
 */
const INVALID_SIGNATURE_BODY = {
  result: { code: 1, message: "Invalid Signature." },
  targetUrl: null,
  success: true,
  error: null,
  unAuthorizedRequest: false,
  __abp: true,
}

const TRANSACTION_NOT_FOUND_BODY = {
  result: null,
  targetUrl: null,
  success: false,
  error: {
    code: 2010,
    message: "Transaction Not Found",
    details: null,
    validationErrors: null,
  },
  unAuthorizedRequest: false,
  __abp: true,
}

test("a rejected signature is a failure despite success being true", () => {
  // The trap this module exists for. Branching on `success` would treat an
  // entirely failed, unauthenticated call as having worked — and for
  // InitialSession that means recording a payment session that does not exist
  // and sending a merchant to it.
  assert.equal(INVALID_SIGNATURE_BODY.success, true)

  const outcome = readCommercePayResponse(INVALID_SIGNATURE_BODY)
  assert.equal(outcome.ok, false)
  if (outcome.ok) return
  assert.equal(outcome.code, 1)
  assert.equal(outcome.message, "Invalid Signature.")
  assert.equal(outcome.isSignatureFailure, true)
})

test("a missing transaction is read from the error object", () => {
  const outcome = readCommercePayResponse(TRANSACTION_NOT_FOUND_BODY)
  assert.equal(outcome.ok, false)
  if (outcome.ok) return
  assert.equal(outcome.code, TRANSACTION_ERROR_CODES.transactionNotFound)
  assert.equal(outcome.message, "Transaction Not Found")
  assert.equal(outcome.isSignatureFailure, false)
  assert.equal(isTransactionNotFound(outcome), true)
})

test("a real InitialSession payload reads as success", () => {
  const outcome = readCommercePayResponse<{
    redirectUrl: string
    sessionNumber: string
  }>({
    result: {
      redirectionType: 1,
      redirectUrl: "https://staging-payments.commerce.asia/session/abc",
      sessionNumber: "2037D293E60AEB67B59251030",
    },
    success: true,
    error: null,
    __abp: true,
  })

  assert.equal(outcome.ok, true)
  if (!outcome.ok) return
  assert.equal(outcome.result.sessionNumber, "2037D293E60AEB67B59251030")
})

test("a real Query payload reads as success even though it has a status", () => {
  // `status` is a number but is not `code`, so it must not be mistaken for an
  // error envelope.
  const outcome = readCommercePayResponse<{ status: number; amount: number }>({
    result: {
      transactionNumber: "2005671137F81FD81D89D8",
      referenceCode: "PI-2026/09-014-1",
      status: 1,
      currencyCode: "MYR",
      amount: 127200,
      channelId: 4,
    },
    success: true,
    error: null,
  })

  assert.equal(outcome.ok, true)
  assert.equal(outcome.ok ? outcome.result.status : null, 1)
})

test("an Authenticate payload reads as success", () => {
  const outcome = readCommercePayResponse<{ accessToken: string }>({
    result: { accessToken: "abc", expireInSeconds: 86400 },
    success: true,
    error: null,
  })
  assert.equal(outcome.ok, true)
})

test("a result with a code but no message is not treated as an error", () => {
  // Both halves are required, so a payload that happens to carry a numeric
  // code is not misread as a failure.
  const outcome = readCommercePayResponse<{ code: number }>({
    result: { code: 7 },
    success: true,
    error: null,
  })
  assert.equal(outcome.ok, true)
})

test("an error object wins over whatever result says", () => {
  const outcome = readCommercePayResponse({
    result: { redirectUrl: "https://example.test" },
    success: true,
    error: { code: 2009, message: "Duplicate transaction" },
  })
  assert.equal(outcome.ok, false)
  assert.equal(outcome.ok ? null : outcome.code, 2009)
})

test("success false with no detail is still a failure", () => {
  const outcome = readCommercePayResponse({
    result: null,
    success: false,
    error: null,
  })
  assert.equal(outcome.ok, false)
})

test("a null result with success true is an empty success", () => {
  const outcome = readCommercePayResponse({ result: null, success: true, error: null })
  assert.equal(outcome.ok, true)
})

test("a non-object body is a failure rather than a crash", () => {
  for (const body of [null, undefined, "", "not json", 42]) {
    const outcome = readCommercePayResponse(body)
    assert.equal(outcome.ok, false)
  }
})

test("detects a signature failure by message even if the code changes", () => {
  const outcome = readCommercePayResponse({
    result: { code: 99, message: "Invalid Signature." },
    success: true,
    error: null,
  })
  assert.equal(outcome.ok ? false : outcome.isSignatureFailure, true)
})

// ---------------------------------------------------------------------------
// Retry classification
// ---------------------------------------------------------------------------

test("a signature failure is never retryable", () => {
  // The identical request signs identically, so a retry cannot help and only
  // wastes a rate-limited call.
  assert.equal(isRetryable(readCommercePayResponse(INVALID_SIGNATURE_BODY)), false)
})

test("a duplicate transaction is not retryable without a new reference", () => {
  // This is why a payment session carries a sequence number: a term change
  // reprices the invoice and needs a fresh referenceCode, not a retry.
  const outcome = readCommercePayResponse({
    result: null,
    success: false,
    error: { code: TRANSACTION_ERROR_CODES.duplicateTransaction, message: "Duplicate" },
  })
  assert.equal(isRetryable(outcome), false)
})

test("a transaction not found is retryable, since it may not exist yet", () => {
  // The reconciliation sweep queries sessions the gateway may not have
  // finished recording.
  assert.equal(isRetryable(readCommercePayResponse(TRANSACTION_NOT_FOUND_BODY)), true)
})

test("a success is not retryable", () => {
  assert.equal(
    isRetryable(readCommercePayResponse({ result: { ok: 1 }, success: true })),
    false
  )
})
