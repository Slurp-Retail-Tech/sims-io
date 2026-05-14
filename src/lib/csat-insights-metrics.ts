export const CSAT_SENT_LINK_HISTORY_FIELDS = [
  "csat_link_shared",
  "csat_link_shared_at",
  "csat_whatsapp_sent",
] as const

export function csatSentLinkHistoryFieldsSql() {
  return CSAT_SENT_LINK_HISTORY_FIELDS.map((field) => `'${field}'`).join(", ")
}
