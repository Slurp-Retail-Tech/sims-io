#!/usr/bin/env node
/**
 * Check the Respond.io Developer API connection, and optionally send one test
 * email through it.
 *
 * Two modes, deliberately separated:
 *
 *   node scripts/verify-respondio.mjs
 *     Read-only. Lists the workspace's channels and prints the ids to put in
 *     .env. Sends nothing.
 *
 *   node scripts/verify-respondio.mjs --send you@yourdomain.com
 *     Sends ONE test email to the address you name, through the email channel.
 *
 * The send requires an explicit address on the command line, with no default
 * and no fallback, because the failure mode of getting this wrong is emailing
 * a real merchant a test message. It also refuses more than one recipient.
 *
 * Reads RESPONDIO_API_TOKEN and RESPONDIO_API_BASE_URL. Never prints the token.
 */

import { readFileSync } from "node:fs"

function loadDotEnv() {
  try {
    for (const line of readFileSync(".env", "utf8").split("\n")) {
      const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim())
      if (match && !process.env[match[1]]) {
        process.env[match[1]] = match[2]
      }
    }
  } catch {
    // No .env is fine.
  }
}

loadDotEnv()

const BASE_URL = (
  process.env.RESPONDIO_API_BASE_URL || "https://api.respond.io/v2"
).replace(/\/+$/, "")
const TOKEN = process.env.RESPONDIO_API_TOKEN

if (!TOKEN) {
  console.error("Missing RESPONDIO_API_TOKEN.")
  console.error("Add it to .env (which is gitignored) and run this again.")
  console.error("Generate one at: Settings > Integration > Developer API")
  process.exit(2)
}

const args = process.argv.slice(2)
const sendIndex = args.indexOf("--send")
const recipients = sendIndex === -1 ? [] : args.slice(sendIndex + 1)

if (sendIndex !== -1 && recipients.length !== 1) {
  console.error(
    "--send takes exactly one email address.\n" +
      "Naming the recipient explicitly is deliberate: the failure mode here is\n" +
      "emailing a real merchant a test message."
  )
  process.exit(2)
}

const recipient = recipients[0] ?? null
if (recipient && !/^[^@\s]+@[^@.\s]+(\.[^@.\s]+)+$/.test(recipient)) {
  console.error(`Not a usable email address: ${recipient}`)
  process.exit(2)
}

async function api(path, init = {}) {
  const response = await fetch(`${BASE_URL}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      "Content-Type": "application/json",
      Accept: "application/json",
      ...(init.headers ?? {}),
    },
  })
  const text = await response.text()
  let parsed = null
  try {
    parsed = text ? JSON.parse(text) : null
  } catch {
    parsed = null
  }
  return { status: response.status, ok: response.ok, body: parsed, text }
}

async function main() {
  console.log(`Host: ${BASE_URL}`)
  console.log("Listing channels…\n")

  const channels = await api("/space/channel")

  if (channels.status === 401 || channels.status === 403) {
    console.error(
      `Rejected with ${channels.status}. The token is missing, wrong, or revoked.`
    )
    process.exit(1)
  }
  if (!channels.ok) {
    console.error(`Channel list failed: ${channels.status}`)
    console.error(channels.text.slice(0, 300))
    process.exit(1)
  }

  const list = Array.isArray(channels.body)
    ? channels.body
    : (channels.body?.items ?? [])

  if (list.length === 0) {
    console.error("The token works, but the workspace has no channels.")
    process.exit(1)
  }

  console.log("  id        source        name")
  for (const channel of list) {
    console.log(
      `  ${String(channel.id).padEnd(9)} ${String(channel.source ?? "?").padEnd(13)} ${channel.name ?? ""}`
    )
  }

  const emailish = list.filter((channel) =>
    /mail|email|gmail/i.test(`${channel.source} ${channel.name}`)
  )
  const whatsappish = list.filter((channel) =>
    /whatsapp/i.test(`${channel.source} ${channel.name}`)
  )

  console.log("\nSuggested .env values:")
  if (emailish.length > 0) {
    console.log(`  RESPONDIO_EMAIL_CHANNEL_ID=${emailish[0].id}`)
    if (emailish.length > 1) {
      console.log(
        `    (${emailish.length} email-like channels found — check the list above)`
      )
    }
  } else {
    console.log("  RESPONDIO_EMAIL_CHANNEL_ID=   # no email channel found")
  }
  if (whatsappish.length > 0) {
    console.log(`  RESPONDIO_WHATSAPP_CHANNEL_ID=${whatsappish[0].id}`)
  } else {
    console.log("  RESPONDIO_WHATSAPP_CHANNEL_ID=   # none yet; add when ready")
  }

  if (!recipient) {
    console.log(
      "\nRead-only run; nothing was sent.\n" +
        "To send one test email:  node scripts/verify-respondio.mjs --send you@yourdomain.com"
    )
    return
  }

  const channelId =
    Number(process.env.RESPONDIO_EMAIL_CHANNEL_ID) || emailish[0]?.id
  if (!channelId) {
    console.error("\nNo email channel to send through.")
    process.exit(1)
  }

  console.log(`\nSending one test email to ${recipient} via channel ${channelId}…`)

  const identifier = `email:${recipient}`
  const send = await api(`/contact/${encodeURIComponent(identifier)}/message`, {
    method: "POST",
    body: JSON.stringify({
      channelId,
      message: {
        type: "email",
        subject: "SIMS renewal messaging — connection test",
        text:
          "This is a connection test from SIMS.\n\n" +
          "It confirms that renewal reminders and receipts can be delivered " +
          "through Respond.io's email channel. No action is needed.",
      },
    }),
  })

  if (!send.ok) {
    console.error(`Send failed: ${send.status}`)
    console.error(send.text.slice(0, 400))
    process.exit(1)
  }

  const messageId = send.body?.messageId ?? send.body?.id ?? "(none returned)"
  console.log(`  sent — messageId ${messageId}`)
  console.log(
    "\nCheck that address. If it arrived, renewal dispatch over email is viable\n" +
      "and does not need to wait for WhatsApp template approval."
  )
}

main().catch((error) => {
  console.error(`\nFailed: ${error.message}`)
  process.exit(1)
})
