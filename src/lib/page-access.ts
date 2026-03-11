const normalizePath = (value: string) => value.replace(/\/+$/, "")

const accessRouteMappings: { prefix: string; accessKey: string }[] = [
  {
    prefix: "/merchant-success/onboarding-schedule",
    accessKey: "/onboarding-appointments",
  },
  {
    prefix: "/merchant-success/onboarding-appointments",
    accessKey: "/onboarding-appointments",
  },
  {
    prefix: "/merchant-success/ticket-categories",
    accessKey: "/ticket-categories",
  },
  { prefix: "/merchant-success/clickup-tasks", accessKey: "/tickets" },
  { prefix: "/clickup-tasks", accessKey: "/tickets" },
  { prefix: "/merchant-success/audit-trail", accessKey: "/tickets" },
  { prefix: "/merchant-success/tickets", accessKey: "/tickets" },
  { prefix: "/merchant-success/analytics", accessKey: "/analytics" },
  { prefix: "/merchant-success/csat-insights", accessKey: "/analytics" },
  { prefix: "/merchant-success/sla-breaches", accessKey: "/sla-breaches" },
  { prefix: "/merchant-success/overview", accessKey: "/merchant-success" },
  { prefix: "/merchant-success", accessKey: "/merchant-success" },
  { prefix: "/sales", accessKey: "/sales" },
  { prefix: "/renewal-retention", accessKey: "/renewal-retention" },
  { prefix: "/renewals", accessKey: "/renewals" },
  { prefix: "/tickets", accessKey: "/tickets" },
  { prefix: "/analytics", accessKey: "/analytics" },
  { prefix: "/merchants", accessKey: "/merchants" },
  { prefix: "/plus", accessKey: "/merchants" },
  { prefix: "/knowledge-base", accessKey: "/knowledge-base" },
  { prefix: "/dashboard", accessKey: "/dashboard" },
  { prefix: "/users", accessKey: "/users" },
  { prefix: "/user-management", accessKey: "/user-management" },
  { prefix: "/settings", accessKey: "/settings" },
  { prefix: "/preferences", accessKey: "/preferences" },
  { prefix: "/profile", accessKey: "/profile" },
]

const sortedMappings = [...accessRouteMappings].sort(
  (a, b) => b.prefix.length - a.prefix.length
)

export const GENERAL_OVERVIEW_PATH = "/overview"

export const hasUniversalAccess = (path: string) =>
  normalizePath(path) === GENERAL_OVERVIEW_PATH

export function getAccessKeyForPath(path: string) {
  const normalized = normalizePath(path)
  for (const mapping of sortedMappings) {
    const prefix = normalizePath(mapping.prefix)
    if (normalized === prefix || normalized.startsWith(`${prefix}/`)) {
      return mapping.accessKey
    }
  }
  return null
}

export function hasPageAccessForPath(path: string, pageAccess: string[]) {
  if (hasUniversalAccess(path)) {
    return true
  }
  const accessKey = getAccessKeyForPath(path)
  if (accessKey) {
    return pageAccess.includes(accessKey)
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
