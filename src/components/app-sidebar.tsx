"use client"

import * as React from "react"
import { Check, ChevronsUpDown } from "lucide-react"
import { usePathname } from "next/navigation"
import Image from "next/image"

import { NavMain } from "@/components/nav-main"
import { NavUser } from "@/components/nav-user"
import { getSessionUser, type SessionUser } from "@/lib/session"
import { canAccessPath } from "@/lib/page-access"
import { navData, type NavItem } from "@/lib/nav-items"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar"

const filterNavItems = (
  items: NavItem[],
  pageAccess: string[],
  role: string
) =>
  items
    .map((item) => {
      const filteredSubItems = item.items?.filter((subItem) =>
        canAccessPath(role, pageAccess, subItem.url)
      )
      const itemAllowed =
        canAccessPath(role, pageAccess, item.url) ||
        Boolean(filteredSubItems?.length)
      if (!itemAllowed) {
        return null
      }
      return {
        ...item,
        items: filteredSubItems?.length ? filteredSubItems : undefined,
      }
    })
    .filter(Boolean) as NavItem[]

const getFirstAllowedUrl = (items: NavItem[]) => {
  for (const item of items) {
    if (item.url && item.url !== "#") {
      return item.url
    }
    const child = item.items?.find((subItem) => subItem.url && subItem.url !== "#")
    if (child) {
      return child.url
    }
  }
  return null
}

type AppSidebarProps = React.ComponentProps<typeof Sidebar> & {
  initialUser: SessionUser
  initialWorkspace: string
}

export function AppSidebar({
  initialUser,
  initialWorkspace,
  ...props
}: AppSidebarProps) {
  const pathname = usePathname()
  // Seed from the server-verified user, not the localStorage cache: the server
  // render can't see localStorage, so the nav would differ and fail hydration.
  // The cache still feeds later updates (e.g. profile edits) via the events.
  const [sessionUser, setSessionUserState] = React.useState<SessionUser | null>(
    initialUser
  )

  React.useEffect(() => {
    const handleSessionUpdate = () => {
      setSessionUserState(getSessionUser())
    }
    window.addEventListener("storage", handleSessionUpdate)
    window.addEventListener("sims-session-update", handleSessionUpdate)
    return () => {
      window.removeEventListener("storage", handleSessionUpdate)
      window.removeEventListener("sims-session-update", handleSessionUpdate)
    }
  }, [])

  // Live counts for items that carry a `badgeKey`. Only fetched when the user
  // can see the item at all; the route enforces the same keys regardless.
  const [badges, setBadges] = React.useState<Partial<Record<NonNullable<NavItem["badgeKey"]>, number>>>({})
  const canSeeQueue = sessionUser
    ? canAccessPath(sessionUser.role ?? "", sessionUser.pageAccess ?? [], "/renewal-retention/actions-required")
    : false

  React.useEffect(() => {
    if (!canSeeQueue) {
      return
    }
    let cancelled = false
    // Re-asked on navigation so fixing something and moving on updates the
    // count; one indexed COUNT, so the cost is negligible.
    fetch("/api/renewals/actions-required/count", { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : null))
      .then((payload: { blocking?: number } | null) => {
        if (!cancelled && payload && typeof payload.blocking === "number") {
          setBadges((current) => ({ ...current, actionsRequiredBlocking: payload.blocking }))
        }
      })
      .catch(() => {
        // A badge is a convenience; a failed count must never break navigation.
      })
    return () => {
      cancelled = true
    }
  }, [canSeeQueue, pathname])

  const withBadges = React.useCallback(
    (items: NavItem[]): NavItem[] =>
      items.map((item) => (item.badgeKey ? { ...item, badge: badges[item.badgeKey] } : item)),
    [badges]
  )

  const userDepartment = sessionUser?.department ?? "Merchant Success"
  const isSuperAdmin = sessionUser?.role === "Super Admin"
  const isAdminOrHigher =
    sessionUser?.role === "Super Admin" || sessionUser?.role === "Admin"
  const pageAccess = sessionUser?.pageAccess ?? []

  const markActive = React.useCallback(
    (items: NavItem[]) =>
      items.map((item) => {
        const subItems =
          item.items?.map((subItem) => ({
            ...subItem,
            isActive: pathname === subItem.url,
          })) ?? item.items
        const isActive =
          pathname === item.url ||
          Boolean(subItems?.some((subItem) => subItem.isActive))
        return {
          ...item,
          isActive,
          items: subItems,
        }
      }),
    [pathname]
  )

  const merchantItems = markActive(
    filterNavItems(navData.merchantSuccess, pageAccess, sessionUser?.role ?? "")
  )
  const salesItems = markActive(
    filterNavItems(navData.sales, pageAccess, sessionUser?.role ?? "")
  )
  const renewalItems = withBadges(
    markActive(filterNavItems(navData.renewalRetention, pageAccess, sessionUser?.role ?? ""))
  )
  const generalItems = markActive(
    filterNavItems(
      navData.general.filter(
        (item) => item.title !== "User Management" || isAdminOrHigher
      ),
      pageAccess,
      sessionUser?.role ?? ""
    )
  )

  const allDepartmentGroups = [
    { label: "Merchant Success", items: merchantItems },
    { label: "Sales & Marketing", items: salesItems },
    { label: "Renewal & Retention", items: renewalItems },
  ].filter((group) => group.items.length > 0)

  const visibleDepartments = isSuperAdmin
    ? allDepartmentGroups
    : allDepartmentGroups

  // Read from the cookie on the server (see the (app) layout) rather than
  // document.cookie, which the server render cannot see.
  const [selectedWorkspace, setSelectedWorkspace] = React.useState(initialWorkspace)

  const selectWorkspace = React.useCallback((label: string) => {
    setSelectedWorkspace(label)
    document.cookie = `sidebar_workspace=${encodeURIComponent(label)}; Max-Age=${60 * 60 * 24 * 30}; Path=/`
  }, [])

  const filteredDepartments =
    selectedWorkspace === "All"
      ? visibleDepartments
      : (visibleDepartments.filter((g) => g.label === selectedWorkspace).length > 0
          ? visibleDepartments.filter((g) => g.label === selectedWorkspace)
          : visibleDepartments)

  const allowedGroups = [
    ...visibleDepartments,
    { label: "General", items: generalItems },
  ]
  const firstAllowedUrl =
    allowedGroups.reduce<string | null>((acc, group) => {
      if (acc) {
        return acc
      }
      return getFirstAllowedUrl(group.items)
    }, null) ?? "/login"

  const homeHref = isSuperAdmin
    ? userDepartment === "Sales & Marketing"
      ? "/sales/overview"
      : userDepartment === "Renewal & Retention"
        ? "/renewal-retention/overview"
        : userDepartment === "Merchant Success"
          ? "/merchant-success/overview"
          : "/merchants"
    : firstAllowedUrl

  return (
    <Sidebar variant="inset" {...props}>
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            {visibleDepartments.length > 1 ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <SidebarMenuButton
                    size="lg"
                    className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
                  >
                    <div className="flex aspect-square size-8 items-center justify-center rounded-lg">
                      <Image
                        src="/system-logo-v2.png"
                        alt="SIMS"
                        width={32}
                        height={32}
                        className="h-8 w-8"
                        priority
                      />
                    </div>
                    <div className="grid flex-1 text-left text-sm leading-tight">
                      <span className="truncate font-medium">SIMS</span>
                      <span className="truncate text-xs">{selectedWorkspace}</span>
                    </div>
                    <ChevronsUpDown className="ml-auto size-4" />
                  </SidebarMenuButton>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  className="w-(--radix-dropdown-menu-trigger-width) min-w-56 rounded-lg"
                  align="start"
                  sideOffset={4}
                >
                  <DropdownMenuItem onSelect={() => selectWorkspace("All")}>
                    <span className="flex-1">All</span>
                    {selectedWorkspace === "All" && <Check className="size-4" />}
                  </DropdownMenuItem>
                  {visibleDepartments.map((group) => (
                    <DropdownMenuItem
                      key={group.label}
                      onSelect={() => selectWorkspace(group.label)}
                    >
                      <span className="flex-1">{group.label}</span>
                      {selectedWorkspace === group.label && <Check className="size-4" />}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            ) : (
              <SidebarMenuButton size="lg" asChild>
                <a href={homeHref}>
                  <div className="flex aspect-square size-8 items-center justify-center rounded-lg">
                    <Image
                      src="/system-logo-v2.png"
                      alt="SIMS"
                      width={32}
                      height={32}
                      className="h-8 w-8"
                      priority
                    />
                  </div>
                  <div className="grid flex-1 text-left text-sm leading-tight">
                    <span className="truncate font-medium">SIMS</span>
                    <span className="truncate text-xs">{userDepartment}</span>
                  </div>
                </a>
              </SidebarMenuButton>
            )}
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        {filteredDepartments.map((group) => (
          <NavMain key={group.label} label={group.label} items={group.items} />
        ))}
        {generalItems.length ? <NavMain label="General" items={generalItems} /> : null}
      </SidebarContent>
      <SidebarFooter>
        <NavUser
          user={{
            name: sessionUser?.name ?? "User",
            email: sessionUser?.email ?? "user@workspace.local",
            avatar: sessionUser?.avatarUrl ?? null,
          }}
        />
      </SidebarFooter>
    </Sidebar>
  )
}
