/**
 * Reading a CommercePay response.
 *
 * This looks like over-engineering for a JSON parse. It is not. The gateway's
 * envelope inverts in a way that will silently turn a failure into a success
 * if read naively, and that failure mode is a merchant being redirected to a
 * payment link that was never created.
 *
 * *** OBSERVED AGAINST STAGING, 17 September 2026 ***
 *
 * A rejected signature comes back as:
 *
 *   HTTP 400
 *   {"result":{"code":1,"message":"Invalid Signature."},
 *    "success":true,"error":null,"__abp":true}
 *
 * A missing transaction comes back as:
 *
 *   HTTP 400
 *   {"result":null,"success":false,
 *    "error":{"code":2010,"message":"Transaction Not Found"},"__abp":true}
 *
 * Two traps in there:
 *
 *  1. **`success: true` accompanies a rejected signature.** Anything branching
 *     on `success` treats an unsigned, unauthenticated, entirely failed call as
 *     having worked. For `InitialSession` that means recording a payment
 *     session that does not exist and sending the merchant to it.
 *
 *  2. **The HTTP status does not match the documentation.** It lists
 *     transaction-level errors such as `TransactionNotFound` (2010) as
 *     500 Internal Server Error. Staging returned 400 for both cases above.
 *     So the status cannot be used to classify the outcome either.
 *
 * The only reliable reading is the body, in this order: an `error` object means
 * failure; a `result` carrying both a numeric `code` and a `message` means
 * failure; anything else is the payload. None of the documented success
 * payloads — `accessToken`, `redirectUrl`/`sessionNumber`, or the Query fields
 * — contain a `code` and a `message`, so that discriminator is unambiguous.
 *
 * Pure and runtime-free so it can be unit-tested under `node --test`.
 */

/** Signature and authentication failures arrive with this code inside `result`. */
export const INVALID_SIGNATURE_CODE = 1

/** Transaction-level codes worth naming; the rest pass through numerically. */
export const TRANSACTION_ERROR_CODES = {
  duplicateTransaction: 2009,
  transactionNotFound: 2010,
  paymentExpired: 2021,
  transactionAlreadyProcessed: 2022,
} as const

export type CommercePayOutcome<T> =
  | { ok: true; result: T }
  | {
      ok: false
      code: number | null
      message: string
      /** True where the failure is the signature, not the request's content. */
      isSignatureFailure: boolean
    }

/**
 * Classify a parsed response body.
 *
 * Takes the already-parsed body rather than the `Response`, so the HTTP status
 * cannot be consulted by accident — it is not trustworthy here, and a function
 * that cannot see it cannot be tempted by it.
 */
export function readCommercePayResponse<T>(
  body: unknown
): CommercePayOutcome<T> {
  if (body === null || typeof body !== "object") {
    return {
      ok: false,
      code: null,
      message: "The gateway returned a response that was not an object.",
      isSignatureFailure: false,
    }
  }

  const envelope = body as {
    result?: unknown
    error?: unknown
    success?: unknown
  }

  // An `error` object is a failure regardless of what `success` claims.
  const error = envelope.error
  if (error && typeof error === "object") {
    const { code, message } = readCodeAndMessage(error)
    return {
      ok: false,
      code,
      message: message ?? "The gateway reported an error with no message.",
      isSignatureFailure: false,
    }
  }

  // A `result` carrying a code AND a message is the signature/auth failure
  // shape — the one that arrives with `success: true`.
  const result = envelope.result
  if (result && typeof result === "object") {
    const { code, message } = readCodeAndMessage(result)
    if (code !== null && message !== null) {
      return {
        ok: false,
        code,
        message,
        isSignatureFailure:
          code === INVALID_SIGNATURE_CODE || /signature/i.test(message),
      }
    }
  }

  if (result === null || result === undefined) {
    // `success: false` with neither a result nor an error still means failure.
    if (envelope.success === false) {
      return {
        ok: false,
        code: null,
        message: "The gateway reported a failure with no detail.",
        isSignatureFailure: false,
      }
    }
    return { ok: true, result: null as T }
  }

  return { ok: true, result: result as T }
}

/** True where the outcome means "this transaction does not exist yet". */
export function isTransactionNotFound<T>(
  outcome: CommercePayOutcome<T>
): boolean {
  return (
    !outcome.ok && outcome.code === TRANSACTION_ERROR_CODES.transactionNotFound
  )
}

/**
 * True where retrying the identical request could plausibly succeed.
 *
 * A signature failure never can: the same request signs the same way. A
 * duplicate transaction never can either — it needs a fresh reference code,
 * which is why a payment session carries a sequence number.
 */
export function isRetryable<T>(outcome: CommercePayOutcome<T>): boolean {
  if (outcome.ok) {
    return false
  }
  if (outcome.isSignatureFailure) {
    return false
  }
  return (
    outcome.code !== TRANSACTION_ERROR_CODES.duplicateTransaction &&
    outcome.code !== TRANSACTION_ERROR_CODES.transactionAlreadyProcessed
  )
}

function readCodeAndMessage(value: object): {
  code: number | null
  message: string | null
} {
  const record = value as { code?: unknown; message?: unknown }
  return {
    code: typeof record.code === "number" ? record.code : null,
    message: typeof record.message === "string" ? record.message : null,
  }
}
