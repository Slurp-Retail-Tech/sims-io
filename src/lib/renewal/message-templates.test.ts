import assert from "node:assert/strict"
import test from "node:test"

import {
  getTemplate,
  GREETING,
  MESSAGE_TEMPLATES,
  renderTemplate,
  SAMPLE_VARIABLES,
} from "./message-templates.ts"

test("every placeholder in every template is a known variable", () => {
  // A typo in a template would otherwise reach a merchant as `{picNmae}`.
  for (const template of MESSAGE_TEMPLATES) {
    for (const text of [template.whatsappBody, template.emailSubject, template.emailBody]) {
      if (!text) continue
      const rendered = renderTemplate(text, SAMPLE_VARIABLES)
      assert.doesNotMatch(rendered, /\{[a-zA-Z]+\}/, `${template.key}: ${rendered}`)
    }
  }
})

test("outlet counts read naturally in singular and plural", () => {
  assert.equal(renderTemplate("{outletCount}", { ...SAMPLE_VARIABLES, outletCount: 1 }), "1 outlet")
  assert.equal(renderTemplate("{outletCount}", { ...SAMPLE_VARIABLES, outletCount: 6 }), "6 outlets")
  assert.equal(
    renderTemplate("{outletCountCapital} valid", { ...SAMPLE_VARIABLES, outletCount: 1 }),
    "The outlet is valid"
  )
})

test("the six-month clause disappears when the plan has no six-month price", () => {
  const withBoth = renderTemplate(getTemplate("reminder_second").emailBody, SAMPLE_VARIABLES)
  assert.match(withBoth, /or RM 4,900\.00 for 6 months/)
  const annualOnly = renderTemplate(getTemplate("reminder_second").emailBody, {
    ...SAMPLE_VARIABLES,
    totalBiAnnual: null,
  })
  assert.doesNotMatch(annualOnly, /6 months/)
  assert.match(annualOnly, /1-year term\./)
})

test("an unknown placeholder is left visible rather than blanked", () => {
  assert.equal(renderTemplate("Hi {nobody}", SAMPLE_VARIABLES), "Hi {nobody}")
})

test("the WhatsApp reminder names match the templates submitted to Meta", () => {
  // v2: the general greeting changed every body, so each is a new template.
  assert.equal(getTemplate("reminder_first").whatsappTemplate, "renewal_reminder_first_v2")
  assert.equal(getTemplate("reminder_second").whatsappTemplate, "renewal_reminder_second_v2")
  assert.equal(getTemplate("reminder_final").whatsappTemplate, "renewal_reminder_final_v2")
  assert.equal(getTemplate("receipt").whatsappTemplate, "renewal_payment_receipt_v2")
  // The payer documents dispatch is email only.
  assert.equal(getTemplate("payer_documents").whatsappTemplate, null)
  assert.equal(getTemplate("payer_documents").emailAttachments, true)
})

test("every message opens with the general greeting and never names the PIC", () => {
  for (const template of MESSAGE_TEMPLATES) {
    assert.ok(template.emailBody.startsWith(`${GREETING}\n\n`), `${template.key} email`)
    if (template.whatsappBody) {
      assert.ok(template.whatsappBody.startsWith(`${GREETING}\n\n`), `${template.key} WhatsApp`)
    }
    assert.ok(!`${template.emailBody}${template.whatsappBody ?? ""}`.includes("{picName}"), template.key)
  }
})

test("reminders name the document the merchant was sent, proforma or quotation", () => {
  const body = getTemplate("reminder_second").emailBody
  assert.match(renderTemplate(body, { ...SAMPLE_VARIABLES, documentLabel: "quotation" }), /Quotation PI-2026\/09-014 is still open/)
  assert.match(renderTemplate(body, SAMPLE_VARIABLES), /Proforma PI-2026\/09-014 is still open/)
})
