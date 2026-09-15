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
  { prefix: "/sales/deals", accessKeys: ["/sales/deals"] },
  { prefix: "/sales/appointments", accessKeys: ["/sales/appointments"] },
  { prefix: "/sales/analytics", accessKeys: ["/sales/analytics"] },
  { prefix: "/sales", accessKeys: ["/sales"] }, // legacy: workspace-level grant
  { prefix: "/renewal-retention/overview", accessKeys: ["/renewal-retention/overview"] },
  { prefix: "/renewal-retention/renewal-due", accessKeys: ["/renewal-retention/renewal-due"] },
  { prefix: "/renewal-retention/analytics", accessKeys: ["/renewal-retention/analytics"] },
  // Renewal module. The three /plans entries are deliberately separate
  // mappings rather than one prefix: `manage` and `approve-override` are
  // capability grants, not pages, and without their own mapping
  // getAccessKeysForPath would fall back to the longest matching prefix and
  // hand a view-only grant the manage key. See page-access.test.ts.
  {
    prefix: "/renewal-retention/plans/approve-override",
    accessKeys: ["/renewal-retention/plans/approve-override"],
  },
  {
    prefix: "/renewal-retention/plans/manage",
    accessKeys: ["/renewal-retention/plans/manage"],
  },
  { prefix: "/renewal-retention/plans", accessKeys: ["/renewal-retention/plans"] },
  // Designating a contact as renewal PIC is a renewal decision recorded on a
  // contact, so it needs this in addition to the Contacts key. Someone who may
  // edit the directory is not thereby entitled to redirect an invoice.
  {
    prefix: "/renewal-retention/subscriptions/manage",
    accessKeys: ["/renewal-retention/subscriptions/manage"],
  },
  // Same explicit-registration rule as the plan keys: a capability that is not
  // its own mapping falls back to the longest prefix and a view grant passes
  // the manage check.
  {
    prefix: "/renewal-retention/invoices/manage",
    accessKeys: ["/renewal-retention/invoices/manage"],
  },
  { prefix: "/renewal-retention/invoices", accessKeys: ["/renewal-retention/invoices"] },
  {
    prefix: "/renewal-retention/actions-required/manage",
    accessKeys: ["/renewal-retention/actions-required/manage"],
  },
  {
    prefix: "/renewal-retention/actions-required",
    accessKeys: ["/renewal-retention/actions-required"],
  },
  { prefix: "/renewal-retention", accessKeys: ["/renewal-retention"] }, // legacy: workspace-level grant
  { prefix: "/tickets", accessKeys: ["/tickets"] },
  { prefix: "/analytics", accessKeys: ["/analytics"] },
  { prefix: "/merchants", accessKeys: ["/merchants"] },
  { prefix: "/contacts", accessKeys: ["/contacts"] },
  { prefix: "/integrations", accessKeys: ["/integrations"] },
  { prefix: "/maps", accessKeys: ["/merchants"] },
  { prefix: "/plus", accessKeys: ["/plus", "/merchants"] },
  { prefix: "/projects", accessKeys: ["/projects"] },
  { prefix: "/knowledge-base", accessKeys: ["/knowledge-base"] },
  { prefix: "/user-management", accessKeys: ["/user-management"] },
  // NOTE: /profile and /preferences are deliberately absent — they are in
  // UNIVERSAL_ACCESS_PREFIXES below, and user-management never offered a
  // grant for them.
]

const sortedMappings = [...accessRouteMappings].sort(
  (a, b) => b.prefix.length - a.prefix.length
)

export const GENERAL_OVERVIEW_PATH = "/overview"

// Paths accessible to all authenticated users regardless of page_access
// Paths every authenticated user may reach regardless of page_access.
// /profile and /preferences show a person their own account and settings —
// they are linked from the user dropdown for everyone, so requiring a grant
// bounced all non-Super-Admin users to the overview.
const UNIVERSAL_ACCESS_PREFIXES = [
  GENERAL_OVERVIEW_PATH,
  "/release-notes",
  "/profile",
  "/preferences",
]

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

export function hasPageAccessForPath(
  path: string,
  pageAccess: readonly string[]
): boolean {
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

export const SUPER_ADMIN_ROLE = "Super Admin"

/**
 * Authorization check for a single route path: Super Admins may access
 * everything; everyone else needs a matching page-access key.
 *
 * A role is just a string, so this stays importable from client components
 * (the sidebar, global search, and the client auth gate all use it).
 */
export function canAccessPath(
  role: string,
  pageAccess: readonly string[],
  path: string
): boolean {
  if (role === SUPER_ADMIN_ROLE) {
    return true
  }
  return hasPageAccessForPath(path, pageAccess)
}

/** OR-semantics over several route paths — access to any one is enough. */
export function canAccessAnyPath(
  role: string,
  pageAccess: readonly string[],
  paths: readonly string[]
): boolean {
  return paths.some((path) => canAccessPath(role, pageAccess, path))
}
