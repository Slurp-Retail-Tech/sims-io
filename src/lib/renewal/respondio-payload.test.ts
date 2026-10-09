import assert from "node:assert/strict"
import test from "node:test"

import {
  buildEmailMessage,
  buildIdentifier,
  buildWhatsappTemplateMessage,
  documentFileName,
  PAYER_TAG,
} from "./respondio-payload.ts"

test("addresses an email contact by their address", () => {
  assert.equal(
    buildIdentifier("email", "aisyah@kedaikopi.com"),
    "email:aisyah@kedaikopi.com"
  )
})

test("addresses a WhatsApp contact in E.164, not as typed", () => {
  // Respond.io matches the exact identifier string, so a locally formatted
  // number would address a different contact, or create one.
  assert.equal(buildIdentifier("whatsapp", "016-220 7781"), "phone:+60162207781")
  assert.equal(buildIdentifier("whatsapp", "+60162207781"), "phone:+60162207781")
})

test("refuses an address that does not belong to the channel", () => {
  assert.equal(buildIdentifier("email", "016-220 7781"), null)
  assert.equal(buildIdentifier("whatsapp", "aisyah@kedaikopi.com"), null)
  assert.equal(buildIdentifier("email", null), null)
  assert.equal(buildIdentifier("whatsapp", ""), null)
})

test("trims an email address before addressing it", () => {
  assert.equal(
    buildIdentifier("email", "  aisyah@kedaikopi.com  "),
    "email:aisyah@kedaikopi.com"
  )
})

test("builds an email with a subject and body", () => {
  const payload = buildEmailMessage({
    subject: "Your renewal is due in 15 days",
    body: "Hello",
    channelId: 42,
  })

  assert.deepEqual(payload, {
    channelId: 42,
    message: { type: "email", subject: "Your renewal is due in 15 days", text: "Hello" },
  })
})

test("omits channelId entirely when none is given", () => {
  // Respond.io then routes through the contact's last interacted channel;
  // sending an explicit null or undefined key is not the same thing.
  const payload = buildEmailMessage({ subject: "s", body: "b" })
  assert.equal("channelId" in payload, false)
})

test("attaches documents by URL rather than uploading them", () => {
  const payload = buildEmailMessage({
    subject: "Payment received",
    body: "Your documents are attached.",
    channelId: 42,
    attachments: [
      { url: "https://sims.example.com/renew/tok/receipt.pdf", fileName: "Receipt.pdf" },
      { url: "https://sims.example.com/renew/tok/invoice.pdf", fileName: "Invoice.pdf" },
    ],
  })

  assert.deepEqual(payload.message, {
    type: "email",
    subject: "Payment received",
    text: "Your documents are attached.",
    attachments: [
      {
        type: "file",
        url: "https://sims.example.com/renew/tok/receipt.pdf",
        fileName: "Receipt.pdf",
      },
      {
        type: "file",
        url: "https://sims.example.com/renew/tok/invoice.pdf",
        fileName: "Invoice.pdf",
      },
    ],
  })
})

test("omits the attachments key when there is nothing to attach", () => {
  const payload = buildEmailMessage({ subject: "s", body: "b" })
  assert.equal("attachments" in payload.message, false)
})

test("builds a WhatsApp template with positional body parameters", () => {
  // Order is the contract with the template Meta approved; it must not be
  // rearranged to read more naturally here.
  const payload = buildWhatsappTemplateMessage({
    templateName: "renewal_reminder_first",
    bodyParameters: ["Kedai Kopi", "15", "RM2,400.00"],
    channelId: 7,
  })

  assert.deepEqual(payload, {
    channelId: 7,
    message: {
      type: "whatsapp_template",
      template: {
        name: "renewal_reminder_first",
        languageCode: "en",
        components: [
          {
            type: "body",
            parameters: [
              { type: "text", text: "Kedai Kopi" },
              { type: "text", text: "15" },
              { type: "text", text: "RM2,400.00" },
            ],
          },
        ],
      },
    },
  })
})

test("defaults the template language to English", () => {
  const payload = buildWhatsappTemplateMessage({
    templateName: "t",
    bodyParameters: [],
  })
  const message = payload.message as { template: { languageCode: string } }
  assert.equal(message.template.languageCode, "en")
})

test("names document files so a merchant recognises them", () => {
  // The invoice number contains a slash, which cannot appear in a filename.
  assert.equal(
    documentFileName("PI-2026/09-014", "proforma"),
    "Proforma-PI-2026-09-014.pdf"
  )
  assert.equal(
    documentFileName("INV-2026/09-001", "invoice"),
    "Tax-Invoice-INV-2026-09-001.pdf"
  )
  assert.equal(
    documentFileName("INV-2026/09-001", "receipt"),
    "Receipt-INV-2026-09-001.pdf"
  )
})

test("the payer tag is stable", () => {
  // Contacts created only to receive documents are tagged so they can be told
  // apart from merchant contacts in the Respond.io inbox.
  assert.equal(PAYER_TAG, "renewal-payer")
})
