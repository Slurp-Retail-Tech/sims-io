export const DEALS_VIEW_COOKIE_NAME = "deals_view"
export type DealsView = "list" | "kanban"

// Session-scoped UI state: 12 hours (volatile-filter tier per CLAUDE.md).
const DEALS_VIEW_COOKIE_MAX_AGE = 60 * 60 * 12

export function readDealsViewCookie(): DealsView {
  if (typeof document === "undefined") {
    return "kanban"
  }
  const match = document.cookie
    .split("; ")
    .find((entry) => entry.startsWith(`${DEALS_VIEW_COOKIE_NAME}=`))
  const value = match?.split("=")[1]
  return value === "list" ? "list" : "kanban"
}

export function writeDealsViewCookie(view: DealsView): void {
  if (typeof document === "undefined") {
    return
  }
  document.cookie = `${DEALS_VIEW_COOKIE_NAME}=${view}; Max-Age=${DEALS_VIEW_COOKIE_MAX_AGE}; Path=/`
}
