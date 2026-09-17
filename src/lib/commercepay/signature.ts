/**
 * CommercePay's `cap-signature`.
 *
 * Every call except Authenticate carries one, and a wrong signature is
 * rejected with a generic 400, so getting this wrong fails everything
 * identically and tells you nothing about why.
 *
 * *** THE PUBLISHED EXAMPLE DOES NOT REPRODUCE ***
 *
 * `CommercePay_API_Documentation.md` gives a worked example: secret key
 * `KPksB8uuh9ZW2VFg`, a request body, and the resulting hash
 * `d006f7f95a33ec2e5e9d2202c2aa0b0156e9d0597904b71cef34d1afacfa8a18`.
 *
 * That hash cannot be reproduced from those inputs. 160 combinations were
 * tried — four URL forms (original casing, lower-cased, trailing slash, none),
 * five bodies (the doc's own original, its step 3 object, its step 5 string,
 * and sorted forms of both), both casings, and four constructions (HMAC with
 * the secret as key, SHA-256 of secret+string, of string+secret, and HMAC with
 * the arguments swapped). None match.
 *
 * The example is also internally inconsistent: its step 3 object shows a
 * different customer email and phone from its step 5 concatenation, and step 5
 * lists `customer` out of the alphabetical order step 3 asks for.
 *
 * So this implements the *prose* steps, which are unambiguous, and treats the
 * example as unusable. The tests below pin the algorithm's own properties —
 * determinism, recursive key sorting, null omission, lower-casing — rather
 * than a vector that does not hold.
 *
 * *** CONFIRMED AGAINST THE STAGING GATEWAY, 17 September 2026 ***
 *
 * `scripts/verify-commercepay-signature.mjs` probed four readings against
 * staging. Three were refused with `Invalid Signature`. This one was not: it
 * reached the transaction lookup and came back `Transaction Not Found` for the
 * deliberately non-existent transaction number, which is only reachable once
 * the signature has validated. The prose was right and the example was wrong.
 *
 * The probe also settled a second question. The documentation spells the
 * timestamp query parameter three ways, and both `timestamp` and `timeStamp`
 * were accepted — not because the gateway tolerates either, but because step 6
 * lower-cases the whole string, so the two spellings are the same by the time
 * they are hashed. That is independent evidence that the lower-casing step is
 * real and applies to property names, not only to values.
 *
 * Re-run that script after a key rotation, and before the first production
 * call, since production issues separate credentials.
 *
 * Pure and runtime-free so it can be unit-tested under `node --test`.
 */

import { createHmac } from "node:crypto"

/** A request body: JSON-shaped, with nested objects allowed. */
export type SignableValue =
  | string
  | number
  | boolean
  | null
  | undefined
  | SignableValue[]
  | { [key: string]: SignableValue }

export type SignableBody = Record<string, SignableValue>

/**
 * Build the string that gets hashed, per the documented steps:
 *
 *   1. the full endpoint URL, without query string and without a trailing slash
 *   2. property names in camelCase (the caller's responsibility — the keys are
 *      passed through as given)
 *   3. properties sorted ascending, recursively
 *   4. serialised as JSON
 *   5. URL concatenated with that JSON
 *   6. the whole string lower-cased
 *
 * Exported separately from `signRequest` because when the gateway rejects a
 * signature, the string that was hashed is the only thing worth looking at,
 * and it must be obtainable without re-deriving it by hand.
 *
 * Note that step 6 lower-cases the *values* as well as the keys, so `MYR`
 * becomes `myr` and an email address loses its casing. That is what the
 * specification says, and what its example shows.
 */
export function buildSignatureBase(
  endpointUrl: string,
  body: SignableBody
): string {
  const url = normalizeEndpointUrl(endpointUrl)
  const json = JSON.stringify(sortAndStripNulls(body))
  return `${url}${json}`.toLowerCase()
}

/** HMAC-SHA256 of the signature base, keyed with the merchant secret. */
export function signRequest(
  endpointUrl: string,
  body: SignableBody,
  secretKey: string
): string {
  return createHmac("sha256", secretKey)
    .update(buildSignatureBase(endpointUrl, body))
    .digest("hex")
}

/**
 * Verify an inbound callback's signature.
 *
 * The callback is signed the same way, over the merchant's own callback URL
 * and the response body. Compared with a length-checked constant-time compare,
 * because this is the only thing standing between a forged callback and an
 * invoice being marked paid.
 */
export function verifyCallbackSignature(input: {
  callbackUrl: string
  body: SignableBody
  presentedSignature: string | null
  secretKey: string
}): boolean {
  const { callbackUrl, body, presentedSignature, secretKey } = input
  if (!presentedSignature) {
    return false
  }

  const expected = signRequest(callbackUrl, body, secretKey)
  return timingSafeEqualHex(expected, presentedSignature.trim().toLowerCase())
}

/**
 * Strip the query string and any trailing slash.
 *
 * A GET endpoint signs its query parameters as part of the data object
 * instead, so they must not also appear in the URL half of the string.
 */
export function normalizeEndpointUrl(endpointUrl: string): string {
  const withoutQuery = endpointUrl.split("?")[0].split("#")[0]
  return withoutQuery.replace(/\/+$/, "")
}

/**
 * Sort keys ascending and drop null and undefined values, recursively.
 *
 * Null-valued properties are excluded because CommercePay excludes them when
 * it validates, so including one produces a signature that will never match.
 * Arrays keep their order — order is meaningful in an array and sorting one
 * would change the payload's meaning, not just its spelling.
 */
export function sortAndStripNulls(value: SignableValue): SignableValue {
  if (Array.isArray(value)) {
    return value
      .filter((entry) => entry !== null && entry !== undefined)
      .map(sortAndStripNulls)
  }

  if (value && typeof value === "object") {
    const sorted: Record<string, SignableValue> = {}
    for (const key of Object.keys(value).sort()) {
      const entry = (value as Record<string, SignableValue>)[key]
      if (entry === null || entry === undefined) {
        continue
      }
      sorted[key] = sortAndStripNulls(entry)
    }
    return sorted
  }

  return value
}

/**
 * Constant-time comparison of two hex digests.
 *
 * `crypto.timingSafeEqual` throws on a length mismatch, which would itself
 * leak, so the length is checked first and a mismatch returns false rather
 * than throwing.
 */
function timingSafeEqualHex(expected: string, presented: string): boolean {
  if (expected.length !== presented.length) {
    return false
  }
  let difference = 0
  for (let index = 0; index < expected.length; index += 1) {
    difference |= expected.charCodeAt(index) ^ presented.charCodeAt(index)
  }
  return difference === 0
}
