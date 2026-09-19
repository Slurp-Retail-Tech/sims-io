import type { Metadata } from "next"

import { requirePageAccess } from "@/lib/auth-server"
import {
  MESSAGE_TEMPLATES,
  renderTemplate,
  SAMPLE_VARIABLES,
} from "@/lib/renewal/message-templates"
import { loadRenewalSettings } from "@/lib/renewal/settings"

import { TemplatesView } from "./templates-view"

export const metadata: Metadata = {
  title: "Renewal – Message Templates",
}

export default async function MessageTemplatesPage() {
  await requirePageAccess(["/renewal-retention/templates"])
  const settings = await loadRenewalSettings().catch(() => null)

  const templates = MESSAGE_TEMPLATES.map((template) => ({
    key: template.key,
    label: template.label,
    whatsappTemplate: template.whatsappTemplate,
    whatsappBody: template.whatsappBody ? renderTemplate(template.whatsappBody, SAMPLE_VARIABLES) : null,
    whatsappButton: template.whatsappButton,
    whatsappNote: template.whatsappNote,
    emailSubject: renderTemplate(template.emailSubject, SAMPLE_VARIABLES),
    emailBody: renderTemplate(template.emailBody, SAMPLE_VARIABLES),
    emailNote: template.emailNote,
    emailAttachments: template.emailAttachments,
  }))

  return (
    <TemplatesView
      templates={templates}
      whatsappChannelId={
        settings?.respondioWhatsappChannelId ?? process.env.RESPONDIO_WHATSAPP_CHANNEL_ID ?? null
      }
      senderEmail={process.env.SMTP_FROM_EMAIL ?? "renewals@getslurp.com"}
    />
  )
}
