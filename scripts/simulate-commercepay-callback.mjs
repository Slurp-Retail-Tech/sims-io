#!/usr/bin/env node
/**
 * Post a correctly signed CommercePay callback to a LOCAL SIMS.
 *
 * The gateway cannot reach a developer's machine, so the callback path is
 * exercised by signing a body exactly as CommercePay would — over the callback
 * URL plus the sorted, null-stripped, lower-cased JSON, HMAC-SHA256 with the
 * merchant secret — and posting it to the local route.
 *
 * Refuses any target that is not localhost or 127.0.0.1: a forged callback
 * against staging or production is precisely what the signature exists to
 * stop, and this script must never be the thing that sends one.
 *
 * Usage:
 *   node scripts/simulate-commercepay-callback.mjs --reference PI-2026-09-003-5 --amount 120000 [--status 1] [--txn TEST123] [--session CAPSESSION] [--bad-signature]
 *
 * `--amount` is in gateway integer units (120000 = RM 1,200.00). Reads
 * COMMERCEPAY_SECRET_KEY and APP_BASE_URL from .env. Prints no credential.
 */

import { createHmac } from "node:crypto"
import { readFileSync } from "node:fs"

function loadDotEnv() {
  try {
    for (const line of readFileSync(".env", "utf8").split("\n")) {
      const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim())
      if (match && !process.env[match[1]]) {
        process.env[match[1]] = match[2].replace(/^(['"])(.*)\1$/, "$2")
      }
    }
  } catch {
    // No .env: rely on the environment.
  }
}

function argValue(name, fallback = null) {
  const index = process.argv.indexOf(`--${name}`)
  return index === -1 ? fallback : process.argv[index + 1] ?? fallback
}

function sortAndStripNulls(value) {
  if (Array.isArray(value)) {
    return value.filter((entry) => entry !== null && entry !== undefined).map(sortAndStripNulls)
  }
  if (value && typeof value === "object") {
    const sorted = {}
    const keys = Object.keys(value).sort((left, right) => {
      const a = left.toLowerCase()
      const b = right.toLowerCase()
      return a < b ? -1 : a > b ? 1 : left < right ? -1 : left > right ? 1 : 0
    })
    for (const key of keys) {
      const entry = value[key]
      if (entry === null || entry === undefined) continue
      sorted[key] = sortAndStripNulls(entry)
    }
    return sorted
  }
  return value
}

loadDotEnv()

const secret = process.env.COMMERCEPAY_SECRET_KEY?.trim()
if (!secret) {
  console.error("COMMERCEPAY_SECRET_KEY is not set.")
  process.exit(1)
}

const base = (argValue("base") ?? process.env.APP_BASE_URL ?? "http://localhost:3000").replace(/\/+$/, "")
const host = new URL(base).hostname
if (host !== "localhost" && host !== "127.0.0.1") {
  console.error(`Refusing to post a forged callback to ${host}. This script targets a local SIMS only.`)
  process.exit(1)
}

const reference = argValue("reference")
const amount = Number(argValue("amount"))
if (!reference || !Number.isInteger(amount)) {
  console.error("Usage: --reference <session reference code> --amount <gateway integer units> [--status 1]")
  process.exit(1)
}

const callbackUrl = `${base}/api/public/commercepay/callback`
const body = {
  amount,
  channelId: 4,
  currencyCode: "MYR",
  referenceCode: reference,
  status: Number(argValue("status", "1")),
  transactionNumber: argValue("txn", `SIM${Date.now().toString(36).toUpperCase()}`),
  paymentSessionNumber: argValue("session"),
  providerTransactionNumber: null,
}

const signatureBase = `${callbackUrl}${JSON.stringify(sortAndStripNulls(body))}`.toLowerCase()
let signature = createHmac("sha256", secret).update(signatureBase).digest("hex")
if (process.argv.includes("--bad-signature")) {
  signature = signature.replace(/^./, (c) => (c === "0" ? "1" : "0"))
}

const response = await fetch(callbackUrl, {
  method: "POST",
  headers: { "Content-Type": "application/json", "cap-signature": signature },
  body: JSON.stringify(body),
})
const text = await response.text()
console.log(`POST ${callbackUrl}`)
console.log(`body ${JSON.stringify(body)}`)
console.log(`→ ${response.status} ${text}`)
