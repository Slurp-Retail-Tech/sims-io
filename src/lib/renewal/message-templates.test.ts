import assert from "node:assert/strict"
import test from "node:test"

import {
  getTemplate,
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
  assert.equal(getTemplate("reminder_first").whatsappTemplate, "renewal_reminder_first")
  assert.equal(getTemplate("reminder_second").whatsappTemplate, "renewal_reminder_second")
  assert.equal(getTemplate("reminder_final").whatsappTemplate, "renewal_reminder_final")
  assert.equal(getTemplate("receipt").whatsappTemplate, "renewal_payment_receipt")
  // The payer documents dispatch is email only.
  assert.equal(getTemplate("payer_documents").whatsappTemplate, null)
  assert.equal(getTemplate("payer_documents").emailAttachments, true)
})
