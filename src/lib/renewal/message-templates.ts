/**
 * The renewal message copy, in one place.
 *
 * Five dispatch types: three reminders, the receipt to the PIC, and the
 * payer documents email. WhatsApp copy is what is submitted to Meta for
 * template approval and must match the approved template body exactly;
 * email copy is sent as written. Both channels go through Respond.io.
 *
 * Variables are `{name}` placeholders substituted at send time. Keeping the
 * copy here, rather than in the dispatch job, means the Templates page shows
 * exactly what a merchant will receive and a copy change is one edit.
 *
 * Pure and runtime-free so substitution is unit-tested.
 */

export type TemplateKey =
  | "reminder_first"
  | "reminder_second"
  | "reminder_final"
  | "receipt"
  | "payer_documents"

export type TemplateVariables = {
  picName: string
  companyName: string
  outletCount: number
  expiryDate: string
  daysToExpiry: number
  invoiceNumber: string
  totalAnnual: string
  totalBiAnnual: string | null
  term: string
  newExpiryDate: string
  amountPaid: string
  taxInvoiceNumber: string
  periodStart: string
  periodEnd: string
  graceDays: number
}

export type MessageTemplate = {
  key: TemplateKey
  label: string
  /** Meta template name, or null where the type is email-only. */
  whatsappTemplate: string | null
  whatsappBody: string | null
  whatsappButton: string | null
  whatsappNote: string
  emailSubject: string
  emailBody: string
  emailNote: string
  /** Whether the email carries the receipt and tax invoice PDFs. */
  emailAttachments: boolean
}

const outlets = (count: number) => (count === 1 ? "1 outlet" : `${count} outlets`)

export const MESSAGE_TEMPLATES: readonly MessageTemplate[] = [
  {
    key: "reminder_first",
    label: "T-15 reminder",
    whatsappTemplate: "renewal_reminder_first",
    whatsappBody:
      "Hi {picName},\n\n{companyName}'s Slurp licence for {outletCount} expires on {expiryDate}, {daysToExpiry} days from today.\n\nYour proforma {invoiceNumber} is ready. You can review it, choose a 1-year or 6-month term, and pay online.",
    whatsappButton: "View and renew",
    whatsappNote: "Sent at T-15 to the renewal PIC and every CC contact with WhatsApp enabled.",
    emailSubject: "Renewal due in {daysToExpiry} days: {companyName} ({outletCount})",
    emailBody:
      "Hi {picName},\n\n{companyName}'s Slurp licence for {outletCount} expires on {expiryDate}.\n\nProforma {invoiceNumber} totals {totalAnnual} at the 1-year term. Opening the link lets you switch to a 6-month term, see the new expiry date either choice produces, print the proforma, and pay by card or FPX.\n\nSlurp Renewals",
    emailNote: "One dispatch row per recipient and channel. A failure on one channel is retried only on that channel.",
    emailAttachments: false,
  },
  {
    key: "reminder_second",
    label: "T-5 reminder",
    whatsappTemplate: "renewal_reminder_second",
    whatsappBody:
      "Hi {picName},\n\nA reminder that {companyName}'s licence for {outletCount} expires on {expiryDate}, {daysToExpiry} days away.\n\nProforma {invoiceNumber} · {totalAnnual} at the 1-year term.",
    whatsappButton: "View and renew",
    whatsappNote: "Sent at T-5 against the same invoice created at T-15. No new number.",
    emailSubject: "Renewal due in {daysToExpiry} days: {companyName} ({outletCount})",
    emailBody:
      "Hi {picName},\n\n{companyName}'s licence for {outletCount} expires on {expiryDate}, in {daysToExpiry} days.\n\nProforma {invoiceNumber} is still open at {totalAnnual} for the 1-year term{biAnnualClause}.\n\nSlurp Renewals",
    emailNote: "The T-5 and T-1 runs reuse the invoice created at T-15, so the merchant's existing link keeps working.",
    emailAttachments: false,
  },
  {
    key: "reminder_final",
    label: "T-1 reminder",
    whatsappTemplate: "renewal_reminder_final",
    whatsappBody:
      "Hi {picName},\n\n{companyName}'s licence for {outletCount} expires tomorrow, {expiryDate}.\n\nRenewing today keeps every outlet running without interruption.",
    whatsappButton: "Renew now",
    whatsappNote: "The last message in the cadence. There is no post-expiry chase.",
    emailSubject: "Renewal due tomorrow: {companyName} ({outletCount})",
    emailBody:
      "Hi {picName},\n\n{companyName}'s licence for {outletCount} expires tomorrow, {expiryDate}.\n\nProforma {invoiceNumber} · {totalAnnual} at the 1-year term. The renewal link stays payable for {graceDays} days after expiry, and a payment inside that window still extends from {expiryDate}.\n\nSlurp Renewals",
    emailNote: "Cadence ends here. Follow-up on a non-renewed subscription is worked from the Renewal List.",
    emailAttachments: false,
  },
  {
    key: "receipt",
    label: "Receipt to PIC",
    whatsappTemplate: "renewal_payment_receipt",
    whatsappBody:
      "Payment received. Thank you.\n\n{companyName} · {outletCount} renewed for {term}.\nAmount: {amountPaid}\nNew expiry: {newExpiryDate}\n\nYour receipt and tax invoice are ready.",
    whatsappButton: "View receipt",
    whatsappNote: "Sent on confirmed payment to the PIC and CC contacts, carrying a link to the receipt page.",
    emailSubject: "Payment received: {companyName} renewal",
    emailBody:
      "Hi {picName},\n\nWe have received {amountPaid} for {companyName}'s renewal. {outletCountCapital} now valid until {newExpiryDate}.\n\nThe receipt and tax invoice are on the receipt page, and were emailed to the address entered at payment.\n\nSlurp Renewals",
    emailNote: "Where the payer email matches the PIC's, one email is sent and the PIC's email receipt is suppressed. Their WhatsApp receipt still goes out.",
    emailAttachments: false,
  },
  {
    key: "payer_documents",
    label: "Payer documents",
    whatsappTemplate: null,
    whatsappBody: null,
    whatsappButton: null,
    whatsappNote: "Email only. It carries the PDFs to whoever paid, who may not be a WhatsApp contact at all.",
    emailSubject: "Your receipt and tax invoice: {companyName}",
    emailBody:
      "Thank you for your payment of {amountPaid}.\n\nAttached are the receipt and the tax invoice {taxInvoiceNumber} for {companyName}, covering {outletCount} for the period {periodStart} to {periodEnd}.\n\nSlurp Renewals",
    emailNote: "Sent immediately on confirmed payment. A payer who is not already a Respond.io contact is created as one, tagged renewal-payer, with the conversation closed immediately.",
    emailAttachments: true,
  },
]

export function getTemplate(key: TemplateKey): MessageTemplate {
  const template = MESSAGE_TEMPLATES.find((entry) => entry.key === key)
  if (!template) {
    throw new Error(`Unknown message template: ${key}`)
  }
  return template
}

/**
 * Substitute `{name}` placeholders. An unknown placeholder is left in place
 * rather than silently blanked, so a typo in a template is visible in the
 * preview instead of producing a message with a hole in it.
 */
export function renderTemplate(text: string, variables: TemplateVariables): string {
  const values: Record<string, string> = {
    picName: variables.picName,
    companyName: variables.companyName,
    outletCount: outlets(variables.outletCount),
    outletCountCapital:
      variables.outletCount === 1 ? "The outlet is" : `All ${variables.outletCount} outlets are`,
    expiryDate: variables.expiryDate,
    daysToExpiry: String(variables.daysToExpiry),
    invoiceNumber: variables.invoiceNumber,
    totalAnnual: variables.totalAnnual,
    biAnnualClause: variables.totalBiAnnual ? `, or ${variables.totalBiAnnual} for 6 months` : "",
    term: variables.term,
    newExpiryDate: variables.newExpiryDate,
    amountPaid: variables.amountPaid,
    taxInvoiceNumber: variables.taxInvoiceNumber,
    periodStart: variables.periodStart,
    periodEnd: variables.periodEnd,
    graceDays: String(variables.graceDays),
  }
  return text.replace(/\{([a-zA-Z]+)\}/g, (match, name: string) =>
    name in values ? values[name] : match
  )
}

/** Sample values for the Templates page preview. */
export const SAMPLE_VARIABLES: TemplateVariables = {
  picName: "Tan Wei Ling",
  companyName: "Teh Tarik House",
  outletCount: 6,
  expiryDate: "2 Oct 2026",
  daysToExpiry: 15,
  invoiceNumber: "PI-2026/09-014",
  totalAnnual: "RM 8,400.00",
  totalBiAnnual: "RM 4,900.00",
  term: "1 year",
  newExpiryDate: "2 Oct 2027",
  amountPaid: "RM 8,400.00",
  taxInvoiceNumber: "INV-2026/09-014",
  periodStart: "2 Oct 2026",
  periodEnd: "2 Oct 2027",
  graceDays: 30,
}
