/**
 * The words and the payload of one renewal message.
 *
 * Copy lives in `message-templates.ts` so the Templates page shows exactly
 * what a merchant receives. This fills it for one invoice and one recipient
 * and shapes it for Respond.io: an email with a link, or an approved
 * WhatsApp template whose body parameters are positional and whose URL
 * button carries the renewal token as its dynamic suffix (PRD 4.9).
 *
 * Pure and runtime-free so it is unit-tested.
 */

import { daysBetween } from "./invoice-build.ts"
import { formatMinorForDisplay } from "./money.ts"
import { renderTemplate } from "./message-templates.ts"
import type { MessageTemplate, TemplateVariables } from "./message-templates.ts"
import { buildEmailMessage, buildWhatsappTemplateMessage } from "./respondio-payload.ts"
import type { SendPayload } from "./respondio-payload.ts"
import type { Channel } from "./pic-resolution.ts"
import type { DispatchType } from "./dispatch-plan.ts"

/** The facts about an invoice a message needs; a subset of the public view. */
export type MessageFacts = {
  invoiceNumber: string
  companyName: string | null
  franchiseId: string
  outletCount: number
  dueDate: string | null
  term: "annually" | "bi_annually"
  termQuotes: ReadonlyArray<{ term: "annually" | "bi_annually"; totalMinor: number }>
  periodStart: string | null
  periodEnd: string | null
  totalMinor: number
  taxInvoiceNumber: string | null
  lines: ReadonlyArray<{ newValidUntil: string | null }>
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

/** `2 Oct 2026`, the way every renewal document writes a date. */
export function messageDate(value: string | null): string {
  if (!value) {
    return "—"
  }
  const [year, month, day] = value.slice(0, 10).split("-").map(Number)
  return `${day} ${MONTHS[month - 1]} ${year}`
}

export function buildTemplateVariables(
  facts: MessageFacts,
  context: { recipientName: string; today: string; graceDays: number }
): TemplateVariables {
  const quote = (term: "annually" | "bi_annually") =>
    facts.termQuotes.find((entry) => entry.term === term)?.totalMinor ?? null
  const annual = quote("annually")
  const biAnnual = quote("bi_annually")
  // The latest new expiry across the lines: on a grouped invoice every outlet
  // moves by the same term, so this is the date the merchant will recognise.
  const newExpiry =
    facts.lines
      .map((line) => line.newValidUntil)
      .filter((value): value is string => Boolean(value))
      .sort()
      .at(-1) ?? facts.periodEnd

  return {
    picName: context.recipientName,
    companyName: facts.companyName ?? `Franchise ${facts.franchiseId}`,
    outletCount: facts.outletCount,
    expiryDate: messageDate(facts.dueDate),
    daysToExpiry: facts.dueDate ? Math.max(0, daysBetween(context.today, facts.dueDate)) : 0,
    invoiceNumber: facts.invoiceNumber,
    totalAnnual: formatMinorForDisplay(annual ?? facts.totalMinor),
    totalBiAnnual: biAnnual === null ? null : formatMinorForDisplay(biAnnual),
    term: facts.term === "annually" ? "1 year" : "6 months",
    newExpiryDate: messageDate(newExpiry),
    amountPaid: formatMinorForDisplay(facts.totalMinor),
    taxInvoiceNumber: facts.taxInvoiceNumber ?? "",
    periodStart: messageDate(facts.periodStart),
    periodEnd: messageDate(facts.periodEnd),
    graceDays: context.graceDays,
  }
}

/**
 * The WhatsApp body parameters, in the order their placeholders appear.
 *
 * The approved template numbers its variables `{{1}}`, `{{2}}`… in reading
 * order, so the order here is the contract with Meta. Deriving it from the
 * copy means the two cannot drift apart when the copy changes; the template
 * must then be re-submitted, which is true anyway.
 */
export function whatsappBodyParameters(body: string, variables: TemplateVariables): string[] {
  return [...body.matchAll(/\{([a-zA-Z]+)\}/g)].map((match) => renderTemplate(`{${match[1]}}`, variables))
}

export type PayloadResult = { ok: true; payload: SendPayload } | { ok: false; reason: string }

export function buildDispatchPayload(input: {
  dispatchType: DispatchType
  channel: Channel
  template: MessageTemplate
  variables: TemplateVariables
  /** `https://sims.example/renew/{token}` */
  renewUrl: string
  renewalToken: string
  emailChannelId?: number
  whatsappChannelId?: number
}): PayloadResult {
  const { template, variables } = input
  const isReceipt = input.dispatchType === "receipt"

  if (input.channel === "email") {
    const link = isReceipt ? `${input.renewUrl}/receipt` : input.renewUrl
    const lead = isReceipt ? "Your receipt:" : "Open your renewal:"
    return {
      ok: true,
      payload: buildEmailMessage({
        subject: renderTemplate(template.emailSubject, variables),
        body: `${renderTemplate(template.emailBody, variables)}\n\n${lead} ${link}`,
        channelId: input.emailChannelId,
      }),
    }
  }

  if (!template.whatsappTemplate || !template.whatsappBody) {
    return { ok: false, reason: `${template.label} has no WhatsApp template.` }
  }
  if (input.whatsappChannelId === undefined) {
    return { ok: false, reason: "No WhatsApp channel is configured." }
  }
  return {
    ok: true,
    payload: buildWhatsappTemplateMessage({
      templateName: template.whatsappTemplate,
      bodyParameters: whatsappBodyParameters(template.whatsappBody, variables),
      // The button's base URL is fixed in the approved template as the SIMS
      // host plus `/renew/`; only the suffix varies.
      buttonUrlSuffix: isReceipt ? `${input.renewalToken}/receipt` : input.renewalToken,
      channelId: input.whatsappChannelId,
    }),
  }
}
