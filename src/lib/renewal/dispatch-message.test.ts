import assert from "node:assert/strict"
import test from "node:test"

import { buildDispatchPayload, buildTemplateVariables, messageDate, whatsappBodyParameters } from "./dispatch-message.ts"
import type { MessageFacts } from "./dispatch-message.ts"
import { getTemplate } from "./message-templates.ts"

const facts: MessageFacts = {
  invoiceNumber: "PI-2026/09-014",
  companyName: "Teh Tarik House",
  franchiseId: "11007",
  outletCount: 2,
  dueDate: "2026-10-08",
  term: "annually",
  termQuotes: [
    { term: "annually", totalMinor: 240000 },
    { term: "bi_annually", totalMinor: 140000 },
  ],
  periodStart: "2026-10-08",
  periodEnd: "2027-10-08",
  totalMinor: 240000,
  taxInvoiceNumber: null,
  lines: [{ newValidUntil: "2027-10-06" }, { newValidUntil: "2027-10-08" }],
}

const variables = buildTemplateVariables(facts, { recipientName: "Nurul", today: "2026-09-23", graceDays: 30 })

test("variables read the way the documents do", () => {
  assert.equal(variables.expiryDate, "8 Oct 2026")
  assert.equal(variables.daysToExpiry, 15)
  assert.equal(variables.totalAnnual, "RM2,400.00")
  assert.equal(variables.totalBiAnnual, "RM1,400.00")
  assert.equal(variables.newExpiryDate, "8 Oct 2027")
  assert.equal(messageDate(null), "—")
})

test("WhatsApp parameters follow the order of the placeholders in the copy", () => {
  const template = getTemplate("reminder_first")
  const parameters = whatsappBodyParameters(template.whatsappBody ?? "", variables)
  assert.deepEqual(parameters, ["Nurul", "Teh Tarik House", "2 outlets", "8 Oct 2026", "15", "PI-2026/09-014"])
})

test("an email reminder links to the renewal page", () => {
  const result = buildDispatchPayload({
    dispatchType: "reminder_first",
    channel: "email",
    template: getTemplate("reminder_first"),
    variables,
    renewUrl: "https://sims.example/renew/TOKEN",
    renewalToken: "TOKEN",
    emailChannelId: 7,
  })
  assert.equal(result.ok, true)
  const message = result.ok ? (result.payload.message as { subject: string; text: string }) : null
  assert.equal(message?.subject, "Renewal due in 15 days: Teh Tarik House (2 outlets)")
  assert.match(message?.text ?? "", /Open your renewal: https:\/\/sims\.example\/renew\/TOKEN$/)
  assert.equal(result.ok ? result.payload.channelId : null, 7)
})

test("a WhatsApp receipt carries the receipt path as its button suffix", () => {
  const result = buildDispatchPayload({
    dispatchType: "receipt",
    channel: "whatsapp",
    template: getTemplate("receipt"),
    variables,
    renewUrl: "https://sims.example/renew/TOKEN",
    renewalToken: "TOKEN",
    whatsappChannelId: 9,
  })
  assert.equal(result.ok, true)
  const components = result.ok ? (result.payload.message as { template: { components: Array<{ type: string; parameters?: Array<{ text: string }> }> } }).template.components : []
  assert.equal(components.find((component) => component.type === "buttons")?.parameters?.[0].text, "TOKEN/receipt")
})

test("WhatsApp without a channel id is refused rather than sent blind", () => {
  const result = buildDispatchPayload({
    dispatchType: "reminder_final",
    channel: "whatsapp",
    template: getTemplate("reminder_final"),
    variables,
    renewUrl: "https://sims.example/renew/TOKEN",
    renewalToken: "TOKEN",
  })
  assert.deepEqual(result, { ok: false, reason: "No WhatsApp channel is configured." })
})
