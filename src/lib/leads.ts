import type { RowDataPacket } from "mysql2/promise"

export const LEAD_SOURCES = ["web", "mobile", "manual"] as const
export type LeadSource = (typeof LEAD_SOURCES)[number]

export function isLeadSource(value: string): value is LeadSource {
  return (LEAD_SOURCES as readonly string[]).includes(value)
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
    status: row.status,
    assignedUserId: row.assigned_user_id ? String(row.assigned_user_id) : null,
    assignedUserName: row.assigned_user_name,
    archived: Boolean(row.archived),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}
