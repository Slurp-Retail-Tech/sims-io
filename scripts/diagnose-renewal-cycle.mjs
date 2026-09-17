#!/usr/bin/env node
/**
 * Explain why the renewal cycle produced what it produced.
 *
 * An empty Actions Required queue is ambiguous. It can mean:
 *
 *   - the cycle has not run yet;
 *   - it ran and nothing was due on those exact dates;
 *   - the subscription projection has not run, so there is nothing to look at;
 *   - `valid_until` never parsed out of the POS payload, so no outlet can ever
 *     match an offset date.
 *
 * The last one is the dangerous case: everything looks calm and nothing will
 * ever fire. This walks the chain in order and names which case you are in.
 *
 * Strictly read-only. Usage:
 *   node scripts/diagnose-renewal-cycle.mjs
 *
 * Connects via DATABASE_URL, else MYSQL_* — the same resolution the app uses.
 */

import { readFileSync } from "node:fs"
import mysql from "mysql2/promise"

try {
  for (const line of readFileSync(".env", "utf8").split("\n")) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim())
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2]
  }
} catch {
  /* no .env is fine */
}

function connectionConfig() {
  // `dateStrings` matches the app's own pool: a DATE must read back as
  // `YYYY-MM-DD`, not as a local Date whose printed form cannot be compared
  // against an offset by eye.
  const base = { dateStrings: ["DATE", "DATETIME", "TIMESTAMP"], timezone: "Z" }
  const url = process.env.DATABASE_URL?.trim()
  if (url) return { uri: url, ...base }
  return {
    host: process.env.MYSQL_HOST || "127.0.0.1",
    port: Number(process.env.MYSQL_PORT || 3306),
    user: process.env.MYSQL_USER,
    password: process.env.MYSQL_PASSWORD,
    database: process.env.MYSQL_DATABASE,
    ...base,
  }
}

const db = await mysql.createConnection(connectionConfig())
const q = async (sql, values = []) => (await db.query(sql, values))[0]
const one = async (sql, values = []) => (await q(sql, values))[0] ?? {}

const findings = []
const note = (level, text) => findings.push({ level, text })
let ranTypes = new Set()

console.log("Renewal cycle diagnosis\n" + "=".repeat(60))

// --- 1. Did the jobs run? -----------------------------------------------
const runs = await q(
  `SELECT job_type, status, started_at, finished_at, processed_units, progress_json
     FROM job_runs WHERE job_type LIKE 'renewal%' ORDER BY id DESC LIMIT 6`
)

console.log("\n1. Job runs")
if (runs.length === 0) {
  console.log("   none — neither renewal job has ever run")
  note("blocker", "Neither renewal job has run. Trigger the sync, then the cycle.")
} else {
  for (const r of runs) {
    console.log(
      `   ${String(r.job_type).padEnd(28)} ${String(r.status).padEnd(10)} ${r.finished_at ?? r.started_at ?? ""}`
    )
    if (r.progress_json) {
      console.log(`      ${JSON.stringify(r.progress_json)}`)
    }
  }
  ranTypes = new Set(runs.map((r) => r.job_type))
  if (!ranTypes.has("renewal-cycle")) {
    note(
      "blocker",
      "The renewal cycle has never run, so the queue is empty because nothing has evaluated anything."
    )
  }
}

// --- 2. Did the projection produce anything? ----------------------------
const subs = await one(
  `SELECT COUNT(*) AS total,
          SUM(valid_until IS NULL) AS no_date,
          SUM(is_active = 1) AS active,
          SUM(billed_by = 'reseller') AS reseller,
          SUM(billing_hold = 1) AS held
     FROM outlet_subscriptions WHERE deleted_at IS NULL`
)
const outlets = await one(`SELECT COUNT(*) AS total FROM merchant_outlets`)
const payloadDates = await one(
  `SELECT COUNT(*) AS with_date FROM merchant_outlets
    WHERE JSON_UNQUOTE(JSON_EXTRACT(raw_payload, '$.valid_until')) IS NOT NULL`
)

console.log("\n2. Subscription projection")
console.log(`   merchant_outlets rows              ${outlets.total}`)
console.log(`   ...of which carry a valid_until    ${payloadDates.with_date}`)
console.log(`   outlet_subscriptions rows          ${subs.total}`)
console.log(`   ...with no valid_until             ${subs.no_date}`)
console.log(`   ...active / reseller / on hold     ${subs.active} / ${subs.reseller} / ${subs.held}`)

// These are independent questions, so they are independent checks. Chaining
// them would let a cosmetic observation shadow a correctness one — which it
// did: the "populated another way" note hid the parse failure below it.
if (Number(subs.total) === 0) {
  note("blocker", "The projection is empty. Run the subscription sync first.")
}

if (
  Number(subs.total) > 0 &&
  Number(payloadDates.with_date) > 0 &&
  Number(subs.no_date) === Number(subs.total)
) {
  note(
    "blocker",
    `Every one of the ${subs.total} subscriptions has a NULL valid_until, yet ${payloadDates.with_date} POS payloads carry a date. ` +
      "The date format is not being parsed, so nothing will ever become due. " +
      "Check one payload against normalizePosValidUntil in src/lib/renewal/subscription-sync.ts."
  )
} else if (
  Number(subs.total) > 0 &&
  Number(subs.no_date) > Number(subs.total) * 0.2
) {
  note(
    "warn",
    `${subs.no_date} of ${subs.total} subscriptions have no valid_until. Check a few payloads for an unexpected date format.`
  )
}

if (Number(subs.total) > 0 && !ranTypes.has("renewal-subscription-sync")) {
  note(
    "info",
    "The projection holds data but no sync job is recorded, so it was populated another way. " +
      "Schedule the sync so it keeps up with the nightly import."
  )
}

if (
  Number(outlets.total) > 0 &&
  Number(subs.total) > 0 &&
  Number(subs.total) < Number(outlets.total) * 0.5
) {
  note(
    "warn",
    `Only ${subs.total} subscriptions for ${outlets.total} outlets. More exclusions than expected — check the test and closed account flags.`
  )
}

// --- 3. What is actually due, and when? ---------------------------------
const settings = await one(
  `SELECT reminder_offsets_json, dispatch_enabled FROM renewal_settings WHERE id = 1`
)
let offsets = [15, 5, 1]
try {
  const raw = settings.reminder_offsets_json
  const parsed = typeof raw === "string" ? JSON.parse(raw) : raw
  if (Array.isArray(parsed) && parsed.length) offsets = parsed
} catch {
  /* keep the default */
}

const today = (await one(`SELECT CURDATE() AS d`)).d
console.log(`\n3. Due dates (today is ${today}, offsets ${offsets.join(", ")})`)

let dueTotal = 0
for (const offset of offsets) {
  const row = await one(
    `SELECT COUNT(*) AS n FROM outlet_subscriptions
      WHERE deleted_at IS NULL AND is_active = 1
        AND valid_until_date = DATE_ADD(CURDATE(), INTERVAL ? DAY)`,
    [offset]
  )
  dueTotal += Number(row.n)
  console.log(`   T-${String(offset).padEnd(3)} ${String(row.n).padStart(5)} subscription(s)`)
}

const horizon = await q(
  `SELECT valid_until_date AS d, COUNT(*) AS n FROM outlet_subscriptions
    WHERE deleted_at IS NULL AND valid_until_date IS NOT NULL
      AND valid_until_date BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL 45 DAY)
    GROUP BY valid_until_date ORDER BY valid_until_date LIMIT 15`
)
console.log("\n   Expiries in the next 45 days:")
if (horizon.length === 0) {
  console.log("     none")
} else {
  for (const row of horizon) {
    console.log(`     ${row.d}   ${row.n}`)
  }
}

if (Number(subs.total) > 0 && dueTotal === 0) {
  note(
    horizon.length === 0 ? "blocker" : "info",
    horizon.length === 0
      ? "No outlet expires in the next 45 days. Either the dates are wrong, or this cohort genuinely is not due."
      : "Nothing falls on an exact offset date today. The cycle is working; today simply has no cohort. " +
        "Compare the dates above against the offsets."
  )
}

// --- 4. What came out the other end? ------------------------------------
const invoices = await one(
  `SELECT COUNT(*) AS total FROM renewal_invoices WHERE deleted_at IS NULL`
)
const actions = await one(
  `SELECT COUNT(*) AS total,
          SUM(status = 'open') AS open_now,
          SUM(status = 'resolved') AS resolved
     FROM renewal_actions_required`
)
const plans = await one(
  `SELECT (SELECT COUNT(*) FROM subscription_plans WHERE deleted_at IS NULL) AS plans,
          (SELECT COUNT(*) FROM subscription_plan_assignments
            WHERE is_active = 1 AND deleted_at IS NULL) AS assignments,
          (SELECT COUNT(*) FROM contact_outlets WHERE is_renewal_pic = 1) AS pics`
)

console.log("\n4. Output")
console.log(`   invoices                 ${invoices.total}`)
console.log(`   actions (open/resolved)  ${actions.open_now ?? 0} / ${actions.resolved ?? 0}`)
console.log(`   plans / assignments      ${plans.plans} / ${plans.assignments}`)
console.log(`   contacts marked PIC      ${plans.pics}`)
console.log(`   dispatch_enabled         ${settings.dispatch_enabled === 1 ? "ON" : "off"}`)

// --- Verdict ------------------------------------------------------------
console.log("\n" + "=".repeat(60))
if (findings.length === 0) {
  console.log("Nothing looks wrong. An empty queue here means nothing was due.")
} else {
  for (const f of findings) {
    const tag = f.level === "blocker" ? "BLOCKER" : f.level === "warn" ? "WARN   " : "INFO   "
    console.log(`${tag}  ${f.text}`)
  }
}

await db.end()
