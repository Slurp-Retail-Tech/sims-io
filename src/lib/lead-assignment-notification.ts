import { resolveAppBaseUrl } from "@/lib/auth"
import { sendMail } from "@/lib/mail"
import { buildLeadWhatsappUrl } from "@/lib/whatsapp"

/**
 * Notifies a sales agent by email when a lead is assigned to them. Fired from
 * the manual-lead create route and the lead PATCH (re)assignment path. Sending
 * is best-effort: callers wrap this in try/catch so a mail failure never blocks
 * the assignment itself.
 */
export type LeadAssignmentRecipient = {
  name: string
  email: string
}

export type LeadAssignmentLead = {
  id: string
  name: string
  telephone: string
  businessType: string
  businessLocation: string
  origin: string | null
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;")
}

function buildLeadUrl(leadId: string, origin?: string) {
  return `${resolveAppBaseUrl(origin)}/sales/leads/${encodeURIComponent(leadId)}`
}

function buildAssignmentHtml(
  recipient: LeadAssignmentRecipient,
  lead: LeadAssignmentLead,
  leadUrl: string,
  whatsappUrl: string | null
) {
  const rows = [
    ["Lead name", escapeHtml(lead.name)],
    ["Type", escapeHtml(lead.businessType)],
    ["Location", escapeHtml(lead.businessLocation)],
    ["Origin", lead.origin ? escapeHtml(lead.origin) : "--"],
    [
      "Telephone",
      `<a href="tel:${encodeURI(lead.telephone)}" style="color:#0f766e;text-decoration:none;">${escapeHtml(lead.telephone)}</a>`,
    ],
    ["Lead ID", escapeHtml(lead.id)],
  ]

  const tableRows = rows
    .map(
      ([label, value]) => `
        <tr>
          <td style="padding:10px 12px;border-bottom:1px solid #e5e7eb;width:160px;font-weight:600;color:#111827;vertical-align:top;">${label}</td>
          <td style="padding:10px 12px;border-bottom:1px solid #e5e7eb;color:#374151;">${value || "--"}</td>
        </tr>
      `
    )
    .join("")

  return `
    <div style="margin:0;padding:24px;background:#f3f4f6;font-family:Arial,sans-serif;color:#111827;">
      <div style="max-width:640px;margin:0 auto;background:#ffffff;border:1px solid #e5e7eb;border-radius:16px;overflow:hidden;">
        <div style="padding:20px 24px;background:#111827;color:#ffffff;">
          <div style="font-size:12px;letter-spacing:0.08em;text-transform:uppercase;opacity:0.8;">Lead Assigned to You</div>
          <div style="margin-top:8px;font-size:24px;font-weight:700;line-height:1.2;">${escapeHtml(lead.name)}</div>
        </div>
        <div style="padding:24px;">
          <p style="margin:0 0 16px;color:#374151;">Hi ${escapeHtml(recipient.name)}, a new lead has been assigned to you.</p>
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;">
            ${tableRows}
          </table>
          <div style="margin-top:24px;">
            <a href="${escapeHtml(leadUrl)}" style="display:inline-block;padding:10px 18px;background:#0f766e;color:#ffffff;border-radius:8px;text-decoration:none;font-weight:600;">View lead</a>
            ${
              whatsappUrl
                ? `<a href="${escapeHtml(whatsappUrl)}" style="display:inline-block;margin-left:12px;padding:10px 18px;background:#25D366;color:#ffffff;border-radius:8px;text-decoration:none;font-weight:600;">Open in WhatsApp</a>`
                : ""
            }
          </div>
        </div>
        <div style="padding:16px 24px;background:#f9fafb;border-top:1px solid #e5e7eb;font-size:12px;color:#6b7280;">
          Sent by SIMS Lead Notification
        </div>
      </div>
    </div>
  `
}

function buildAssignmentText(
  recipient: LeadAssignmentRecipient,
  lead: LeadAssignmentLead,
  leadUrl: string,
  whatsappUrl: string | null
) {
  return [
    `Hi ${recipient.name}, a new lead has been assigned to you.`,
    "",
    `Lead name: ${lead.name}`,
    `Type: ${lead.businessType}`,
    `Location: ${lead.businessLocation}`,
    `Origin: ${lead.origin ?? "--"}`,
    `Telephone: ${lead.telephone}`,
    `Lead ID: ${lead.id}`,
    "",
    `View lead: ${leadUrl}`,
    ...(whatsappUrl ? [`Open in WhatsApp: ${whatsappUrl}`] : []),
  ].join("\n")
}

export async function sendLeadAssignmentEmail(input: {
  recipient: LeadAssignmentRecipient
  lead: LeadAssignmentLead
  origin?: string
}): Promise<{ sent: boolean }> {
  const { recipient, lead, origin } = input
  if (!recipient.email) {
    return { sent: false }
  }

  const leadUrl = buildLeadUrl(lead.id, origin)
  const whatsappUrl = buildLeadWhatsappUrl(lead.telephone)

  await sendMail({
    to: recipient.email,
    subject: `Lead assigned to you - ${lead.name}`,
    html: buildAssignmentHtml(recipient, lead, leadUrl, whatsappUrl),
    text: buildAssignmentText(recipient, lead, leadUrl, whatsappUrl),
  })

  return { sent: true }
}
