const normalizePath = (value: string) => value.replace(/\/+$/, "")

const accessRouteMappings: { prefix: string; accessKeys: string[] }[] = [
  {
    prefix: "/merchant-success/onboarding-schedule",
    accessKeys: ["/onboarding-appointments"],
  },
  {
    prefix: "/merchant-success/onboarding-appointments",
    accessKeys: ["/onboarding-appointments"],
  },
  {
    prefix: "/merchant-success/ticket-categories",
    accessKeys: ["/ticket-categories"],
  },
  {
    prefix: "/merchant-success/clickup-tasks",
    accessKeys: ["/clickup-tasks", "/tickets"],
  },
  { prefix: "/clickup-tasks", accessKeys: ["/clickup-tasks", "/tickets"] },
  {
    prefix: "/merchant-success/audit-trail",
    accessKeys: ["/audit-trail", "/tickets"],
  },
  { prefix: "/merchant-success/tickets", accessKeys: ["/tickets"] },
  { prefix: "/merchant-success/analytics", accessKeys: ["/analytics"] },
  {
    prefix: "/merchant-success/csat-insights",
    accessKeys: ["/csat-insights", "/analytics"],
  },
  { prefix: "/merchant-success/sla-breaches", accessKeys: ["/sla-breaches"] },
  { prefix: "/merchant-success/overview", accessKeys: ["/merchant-success"] },
  { prefix: "/merchant-success", accessKeys: ["/merchant-success"] },
  { prefix: "/sales/overview", accessKeys: ["/sales/overview"] },
  { prefix: "/sales/leads", accessKeys: ["/sales/leads"] },
  { prefix: "/sales/appointments", accessKeys: ["/sales/appointments"] },
  { prefix: "/sales/analytics", accessKeys: ["/sales/analytics"] },
  { prefix: "/sales", accessKeys: ["/sales"] }, // legacy: workspace-level grant
  { prefix: "/renewal-retention/overview", accessKeys: ["/renewal-retention/overview"] },
  { prefix: "/renewal-retention/renewal-due", accessKeys: ["/renewal-retention/renewal-due"] },
  { prefix: "/renewal-retention/analytics", accessKeys: ["/renewal-retention/analytics"] },
  { prefix: "/renewal-retention", accessKeys: ["/renewal-retention"] }, // legacy: workspace-level grant
  { prefix: "/tickets", accessKeys: ["/tickets"] },
  { prefix: "/analytics", accessKeys: ["/analytics"] },
  { prefix: "/merchants", accessKeys: ["/merchants"] },
  { prefix: "/maps", accessKeys: ["/merchants"] },
  { prefix: "/plus", accessKeys: ["/plus", "/merchants"] },
  { prefix: "/knowledge-base", accessKeys: ["/knowledge-base"] },
  { prefix: "/user-management", accessKeys: ["/user-management"] },
  { prefix: "/preferences", accessKeys: ["/preferences"] },
  { prefix: "/profile", accessKeys: ["/profile"] },
]

const sortedMappings = [...accessRouteMappings].sort(
  (a, b) => b.prefix.length - a.prefix.length
)

export const GENERAL_OVERVIEW_PATH = "/overview"

// Paths accessible to all authenticated users regardless of page_access
const UNIVERSAL_ACCESS_PREFIXES = [GENERAL_OVERVIEW_PATH, "/release-notes"]

export const hasUniversalAccess = (path: string) => {
  const normalized = normalizePath(path)
  return UNIVERSAL_ACCESS_PREFIXES.some(
    (prefix) =>
      normalized === prefix || normalized.startsWith(`${prefix}/`)
  )
}

export function getAccessKeysForPath(path: string) {
  const normalized = normalizePath(path)
  for (const mapping of sortedMappings) {
    const prefix = normalizePath(mapping.prefix)
    if (normalized === prefix || normalized.startsWith(`${prefix}/`)) {
      return mapping.accessKeys
    }
  }
  return null
}

export function hasPageAccessForPath(path: string, pageAccess: string[]) {
  if (hasUniversalAccess(path)) {
    return true
  }
  const accessKeys = getAccessKeysForPath(path)
  if (accessKeys) {
    return accessKeys.some((accessKey) => pageAccess.includes(accessKey))
  }
  const normalized = normalizePath(path)
  return pageAccess.some((access) => {
    const normalizedAccess = normalizePath(access)
    return (
      normalized === normalizedAccess ||
      normalized.startsWith(`${normalizedAccess}/`)
    )
  })
}
