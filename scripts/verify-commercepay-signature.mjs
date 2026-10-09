#!/usr/bin/env node
/**
 * Settle the CommercePay `cap-signature` algorithm against the live gateway.
 *
 * Why this exists: the vendor's published worked example does not reproduce
 * its own stated hash. 160 combinations of URL form, request body, casing and
 * hash construction were tried and none match, and the example is internally
 * inconsistent besides (its step 3 object and step 5 string disagree on the
 * customer's details, and step 5 lists `customer` out of the alphabetical
 * order step 3 asks for). See the header of src/lib/commercepay/signature.ts.
 *
 * With no trustworthy vector, the only authority is the gateway. This script
 * authenticates against staging, then sends a deliberately harmless signed
 * request under each candidate interpretation and reports which ones the
 * gateway does NOT reject as a bad signature.
 *
 * It is read-only: it queries a transaction number that does not exist. It
 * never creates a payment, and it never prints a credential.
 *
 * Usage:
 *   node scripts/verify-commercepay-signature.mjs
 *
 * Reads COMMERCEPAY_BASE_URL, COMMERCEPAY_TENANT_ID, COMMERCEPAY_USERNAME,
 * COMMERCEPAY_PASSWORD and COMMERCEPAY_SECRET_KEY from the environment.
 * Plain .mjs so it runs without a build step, matching scripts/migrate.mjs.
 */

import { createHmac } from "node:crypto"
import { readFileSync } from "node:fs"

/** Load .env without a dependency, so this runs the same way migrate.mjs does. */
function loadDotEnv() {
  try {
    for (const line of readFileSync(".env", "utf8").split("\n")) {
      const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim())
      if (match && !process.env[match[1]]) {
        // Strip matching surrounding quotes, as dotenv and Node's --env-file
        // do. A password holding `#` or `$` has to be quoted for those two
        // parsers, and this script must read the same value they do.
        process.env[match[1]] = match[2].replace(/^(['"])(.*)\1$/, "$2")
      }
    }
  } catch {
    // No .env is fine; the variables may come from the real environment.
  }
}

loadDotEnv()

const BASE_URL = (
  process.env.COMMERCEPAY_BASE_URL || "https://staging-payments.commerce.asia"
).replace(/\/+$/, "")
const TENANT_ID = process.env.COMMERCEPAY_TENANT_ID
const USERNAME = process.env.COMMERCEPAY_USERNAME
const PASSWORD = process.env.COMMERCEPAY_PASSWORD
const SECRET_KEY = process.env.COMMERCEPAY_SECRET_KEY

const missing = Object.entries({
  COMMERCEPAY_TENANT_ID: TENANT_ID,
  COMMERCEPAY_USERNAME: USERNAME,
  COMMERCEPAY_PASSWORD: PASSWORD,
  COMMERCEPAY_SECRET_KEY: SECRET_KEY,
})
  .filter(([, value]) => !value)
  .map(([name]) => name)

if (missing.length > 0) {
  console.error("Missing configuration:\n  " + missing.join("\n  "))
  console.error("\nAdd them to .env (which is gitignored) and run this again.")
  process.exit(2)
}

if (!/staging/.test(BASE_URL)) {
  console.error(
    `Refusing to probe a non-staging host: ${BASE_URL}\n` +
      "This script is for staging only."
  )
  process.exit(2)
}

function sortAndStripNulls(value) {
  if (Array.isArray(value)) {
    return value.filter((v) => v != null).map(sortAndStripNulls)
  }
  if (value && typeof value === "object") {
    const out = {}
    for (const key of Object.keys(value).sort()) {
      if (value[key] == null) continue
      out[key] = sortAndStripNulls(value[key])
    }
    return out
  }
  return value
}

const hmac = (input) =>
  createHmac("sha256", SECRET_KEY).update(input).digest("hex")

/**
 * The candidate readings.
 *
 * `spec` is what src/lib/commercepay/signature.ts implements and what the
 * prose steps describe. The others exist because the documentation is
 * self-contradictory about casing and about the timestamp property's name.
 */
function candidates(url, data) {
  const sorted = JSON.stringify(sortAndStripNulls(data))
  const unsorted = JSON.stringify(data)
  return {
    spec: hmac((url + sorted).toLowerCase()),
    "sorted, original case": hmac(url + sorted),
    "unsorted, lowercased": hmac((url + unsorted).toLowerCase()),
    "lowercase url only": hmac(url.toLowerCase() + sorted),
  }
}

async function authenticate() {
  const response = await fetch(`${BASE_URL}/api/TokenAuth/Authenticate`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Abp-TenantId": String(TENANT_ID),
    },
    body: JSON.stringify({
      userNameOrEmailAddress: USERNAME,
      password: PASSWORD,
    }),
  })

  const text = await response.text()
  if (!response.ok) {
    // Never echo the body verbatim in case it reflects the submitted username.
    throw new Error(
      `Authenticate returned ${response.status}. Check the tenant id, username and password.`
    )
  }

  const payload = JSON.parse(text)
  const token = payload.accessToken ?? payload.result?.accessToken
  if (!token) {
    throw new Error("Authenticate succeeded but returned no accessToken.")
  }
  return {
    token,
    expiresIn: payload.expireInSeconds ?? payload.result?.expireInSeconds ?? null,
  }
}

/** A transaction number that cannot exist, so nothing is created or changed. */
const PROBE_TRANSACTION = "SIMSPROBE000000000000000"

async function probe(token, label, data, signature) {
  const query = new URLSearchParams({
    TransactionNumber: data.transactionNumber ?? PROBE_TRANSACTION,
    Timestamp: String(data.timestamp ?? data.timeStamp),
  })
  const url = `${BASE_URL}/api/services/app/PaymentGateway/Query`

  const response = await fetch(`${url}?${query}`, {
    method: "GET",
    headers: {
      "Content-Type": "application/json",
      "Abp-TenantId": String(TENANT_ID),
      Authorization: `Bearer ${token}`,
      "cap-signature": signature,
    },
  })

  const text = await response.text()
  const looksLikeBadSignature = /signature/i.test(text)
  const looksLikeBadTimestamp = /timestamp/i.test(text)

  return {
    label,
    status: response.status,
    rejectedForSignature: looksLikeBadSignature,
    rejectedForTimestamp: looksLikeBadTimestamp,
    body: text.slice(0, 300),
  }
}

async function main() {
  console.log(`Host: ${BASE_URL}`)
  console.log("Authenticating…")

  const { token, expiresIn } = await authenticate()
  console.log(
    `  ok — token received${expiresIn ? `, expires in ${expiresIn}s` : ""}\n`
  )

  const timestamp = Date.now()

  // The documentation spells the timestamp parameter three different ways.
  // Both readings are probed, since a wrong property name and a wrong casing
  // fail identically from the outside.
  const shapes = {
    timestamp: { transactionNumber: PROBE_TRANSACTION, timestamp },
    timeStamp: { transactionNumber: PROBE_TRANSACTION, timeStamp: timestamp },
  }

  const url = `${BASE_URL}/api/services/app/PaymentGateway/Query`
  const results = []

  for (const [shapeName, data] of Object.entries(shapes)) {
    for (const [candidateName, signature] of Object.entries(
      candidates(url, data)
    )) {
      results.push(
        await probe(token, `${candidateName} / ${shapeName}`, data, signature)
      )
    }
  }

  console.log("Probe results — a signature the gateway does NOT complain about")
  console.log("is the one to keep:\n")

  const accepted = []
  for (const result of results) {
    const verdict = result.rejectedForSignature
      ? "signature rejected"
      : result.rejectedForTimestamp
        ? "timestamp rejected"
        : "signature NOT rejected"
    if (!result.rejectedForSignature) {
      accepted.push(result.label)
    }
    console.log(`  [${result.status}] ${verdict.padEnd(22)} ${result.label}`)
    console.log(`         ${result.body.replace(/\s+/g, " ").slice(0, 160)}`)
  }

  console.log("")
  if (accepted.length === 0) {
    console.log(
      "Every candidate was rejected on its signature. The algorithm is not yet\n" +
        "understood; send these results to Commerce.Asia support."
    )
    process.exit(1)
  }

  console.log(`Accepted: ${accepted.join(", ")}`)
  if (accepted.includes("spec / timestamp") || accepted.includes("spec / timeStamp")) {
    console.log(
      "The implementation in src/lib/commercepay/signature.ts matches. Nothing to change."
    )
  } else {
    console.log(
      "The implementation in src/lib/commercepay/signature.ts does NOT match.\n" +
        "Adjust buildSignatureBase to the accepted reading before going further."
    )
    process.exit(1)
  }
}

main().catch((error) => {
  console.error(`\nFailed: ${error.message}`)
  process.exit(1)
})
