/**
 * How a renewal message is addressed and shaped for Respond.io.
 *
 * Kept apart from the HTTP client so the parts worth pinning — how a contact
 * is addressed, what an email payload contains, how attachments are named —
 * can be tested without a token or a network.
 *
 * Respond.io addresses a contact by an *identifier*, not an internal id:
 * `email:{address}` or `phone:{e164}`. Both forms create the contact on first
 * write, which is exactly what the payer-documents email needs, since the
 * person settling an invoice is often not a contact SIMS already knows.
 *
 * Pure and runtime-free so it can be unit-tested under `node --test`.
 */

import { isUsableEmail, toE164 } from "./pic-resolution.ts"
import type { Channel } from "./pic-resolution.ts"

/** Tag applied to a contact created solely to receive payment documents. */
export const PAYER_TAG = "renewal-payer"

export type MessageAttachment = {
  /** Must be publicly reachable: Respond.io fetches it rather than uploading. */
  url: string
  fileName: string
}

export type EmailMessage = {
  type: "email"
  text: string
  subject: string
  attachments?: Array<{ type: "file"; url: string; fileName: string }>
}

export type WhatsappTemplateMessage = {
  type: "whatsapp_template"
  template: {
    name: string
    languageCode: string
    components: Array<{
      type: "body" | "header" | "footer" | "buttons"
      parameters?: Array<{ type: "text"; text: string }>
    }>
  }
}

export type SendPayload = {
  channelId?: number
  message: EmailMessage | WhatsappTemplateMessage
}

/**
 * Build the identifier Respond.io addresses a contact by.
 *
 * Returns null when the address cannot be used on that channel, so a caller
 * cannot accidentally address `email:` to a phone number. A phone number is
 * normalised to E.164 first, because Respond.io matches on the exact string
 * and `016-220 7781` is not the same identifier as `+60162207781`.
 */
export function buildIdentifier(
  channel: Channel,
  address: string | null | undefined,
  countryCode?: string
): string | null {
  if (channel === "email") {
    return isUsableEmail(address) ? `email:${(address as string).trim()}` : null
  }

  const e164 = toE164(address, countryCode)
  return e164 ? `phone:${e164}` : null
}

/**
 * An email message, optionally carrying documents.
 *
 * Attachments are referenced by URL rather than uploaded: Respond.io fetches
 * them itself. For renewal documents that means the public token PDF routes,
 * which are already unguessable and rate-limited, so attaching them creates no
 * exposure that the link in the message body did not already create.
 */
export function buildEmailMessage(input: {
  subject: string
  body: string
  attachments?: readonly MessageAttachment[]
  channelId?: number
}): SendPayload {
  const message: EmailMessage = {
    type: "email",
    subject: input.subject,
    text: input.body,
  }

  if (input.attachments && input.attachments.length > 0) {
    message.attachments = input.attachments.map((attachment) => ({
      type: "file",
      url: attachment.url,
      fileName: attachment.fileName,
    }))
  }

  return input.channelId === undefined
    ? { message }
    : { channelId: input.channelId, message }
}

/**
 * A WhatsApp template message.
 *
 * WhatsApp will not accept free text outside a customer service window, so
 * every reminder is a template Meta has approved. The body parameters are
 * positional — `{{1}}`, `{{2}}` — so their order is the contract with the
 * approved template and must not be rearranged to read better here.
 */
export function buildWhatsappTemplateMessage(input: {
  templateName: string
  languageCode?: string
  bodyParameters: readonly string[]
  channelId?: number
}): SendPayload {
  const message: WhatsappTemplateMessage = {
    type: "whatsapp_template",
    template: {
      name: input.templateName,
      languageCode: input.languageCode ?? "en",
      components: [
        {
          type: "body",
          parameters: input.bodyParameters.map((text) => ({
            type: "text" as const,
            text,
          })),
        },
      ],
    },
  }

  return input.channelId === undefined
    ? { message }
    : { channelId: input.channelId, message }
}

/**
 * A filename a merchant will recognise in their inbox.
 *
 * The invoice number contains a slash, which is not usable in a filename, so
 * it is replaced rather than stripped — the number stays readable and still
 * matches the document it names.
 */
export function documentFileName(
  invoiceNumber: string,
  kind: "proforma" | "invoice" | "receipt"
): string {
  const safe = invoiceNumber.replace(/\//g, "-")
  const label =
    kind === "proforma" ? "Proforma" : kind === "invoice" ? "Tax-Invoice" : "Receipt"
  return `${label}-${safe}.pdf`
}
