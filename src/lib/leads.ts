import type { RowDataPacket } from "mysql2/promise"

export const LEAD_SOURCES = ["web", "mobile", "manual"] as const
export type LeadSource = (typeof LEAD_SOURCES)[number]

export function isLeadSource(value: string): value is LeadSource {
  return (LEAD_SOURCES as readonly string[]).includes(value)
}

/**
 * Normalized marketing origin shown in the leads table and notification emails.
 * Derived from the attribution params captured on the demoform landing URL.
 */
export type LeadAttributionParams = {
  utmSource: string | null
  gclid: string | null
  fbclid: string | null
}

const FACEBOOK_SOURCES = new Set(["facebook", "fb", "meta", "instagram", "ig"])
const GOOGLE_SOURCES = new Set(["google", "adwords"])

/**
 * Maps raw attribution params to a friendly origin label. Facebook click id or a
 * Facebook-family utm_source wins first, then Google, then any other explicit
 * utm_source (title-cased), otherwise organic/direct. Returns null only when
 * there is nothing to attribute (so callers can store NULL).
 */
export function deriveLeadOrigin(params: LeadAttributionParams): string | null {
  const source = params.utmSource?.trim().toLowerCase() ?? ""

  if (params.fbclid || FACEBOOK_SOURCES.has(source)) {
    return "Facebook Ads"
  }
  if (params.gclid || GOOGLE_SOURCES.has(source)) {
    return "Google Ads"
  }
  if (source) {
    return source.charAt(0).toUpperCase() + source.slice(1)
  }
  return "Organic / Direct"
}

export const LEAD_STATUSES = ["Unworked", "Worked"] as const
export type LeadStatus = (typeof LEAD_STATUSES)[number]

export function isLeadStatus(value: string): value is LeadStatus {
  return (LEAD_STATUSES as readonly string[]).includes(value)
}

/**
 * Minimal shape of the authenticated user needed for lead authorisation.
 * Mirrors the `AuthUser` used by the sales-appointments helpers.
 */
export type LeadAuthUser = {
  id: string
  name: string
  email: string
  role: string
  department: string
  pageAccess: string[]
}

const MANAGER_ROLES = new Set(["Super Admin", "Admin"])

export function isLeadManager(user: LeadAuthUser): boolean {
  return MANAGER_ROLES.has(user.role)
}

/**
 * SQL fragment + params to AND into a WHERE clause so a non-manager (role
 * "User") only sees leads assigned to them. Managers (Admin / Super Admin) see
 * everything, so the clause is empty.
 */
export function leadScopeClause(
  user: LeadAuthUser,
  column: string
): { clause: string; params: string[] } {
  if (isLeadManager(user)) {
    return { clause: "", params: [] }
  }
  return { clause: `${column} = ?`, params: [user.id] }
}

export function canViewLead(
  user: LeadAuthUser,
  lead: { assigned_user_id: string | null }
): boolean {
  if (isLeadManager(user)) {
    return true
  }
  return lead.assigned_user_id !== null && String(lead.assigned_user_id) === user.id
}

export function canEditLead(
  user: LeadAuthUser,
  lead: { assigned_user_id: string | null }
): boolean {
  // Same rule as view for now: managers edit any lead, users edit only theirs.
  return canViewLead(user, lead)
}

export type LeadRow = RowDataPacket & {
  id: string
  name: string
  telephone: string
  email: string | null
  business_name: string | null
  business_type: string
  business_location: string
  source: string | null
  origin: string | null
  utm_source: string | null
  utm_campaign: string | null
  gclid: string | null
  fbclid: string | null
  status: LeadStatus
  assigned_user_id: string | null
  archived: number
  created_at: string
  updated_at: string
  assigned_user_name: string | null
}

export const leadSelectSql = `
  SELECT
    leads.id,
    leads.name,
    leads.telephone,
    leads.email,
    leads.business_name,
    leads.business_type,
    leads.business_location,
    leads.source,
    leads.origin,
    leads.utm_source,
    leads.utm_campaign,
    leads.gclid,
    leads.fbclid,
    leads.status,
    leads.assigned_user_id,
    leads.archived,
    leads.created_at,
    leads.updated_at,
    assigned_user.name AS assigned_user_name
  FROM leads
  LEFT JOIN users AS assigned_user
    ON assigned_user.id = leads.assigned_user_id
`

export type MappedLead = {
  id: string
  name: string
  telephone: string
  email: string | null
  businessName: string | null
  businessType: string
  businessLocation: string
  source: string | null
  origin: string | null
  utmSource: string | null
  utmCampaign: string | null
  gclid: string | null
  fbclid: string | null
  status: LeadStatus
  assignedUserId: string | null
  assignedUserName: string | null
  archived: boolean
  createdAt: string
  updatedAt: string
}

export function mapLead(row: LeadRow): MappedLead {
  return {
    id: String(row.id),
    name: row.name,
    telephone: row.telephone,
    email: row.email,
    businessName: row.business_name,
    businessType: row.business_type,
    businessLocation: row.business_location,
    source: row.source,
    origin: row.origin,
    utmSource: row.utm_source,
    utmCampaign: row.utm_campaign,
    gclid: row.gclid,
    fbclid: row.fbclid,
    status: row.status,
    assignedUserId: row.assigned_user_id ? String(row.assigned_user_id) : null,
    assignedUserName: row.assigned_user_name,
    archived: Boolean(row.archived),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}
