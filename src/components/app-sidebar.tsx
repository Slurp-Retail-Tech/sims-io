"use client"

import * as React from "react"
import { Check, ChevronsUpDown } from "lucide-react"
import { usePathname } from "next/navigation"
import Image from "next/image"

import { NavMain } from "@/components/nav-main"
import { NavUser } from "@/components/nav-user"
import { getSessionUser } from "@/lib/session"
import { hasPageAccessForPath } from "@/lib/page-access"
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
  isSuperAdmin: boolean
) =>
  items
    .map((item) => {
      const filteredSubItems = item.items?.filter((subItem) =>
        isSuperAdmin ? true : hasPageAccessForPath(subItem.url, pageAccess)
      )
      const itemAllowed = isSuperAdmin
        ? true
        : hasPageAccessForPath(item.url, pageAccess) ||
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

export function AppSidebar({ ...props }: React.ComponentProps<typeof Sidebar>) {
  const pathname = usePathname()
  const [sessionUser, setSessionUserState] = React.useState(() => getSessionUser())

  React.useEffect(() => {
    const handleSessionUpdate = () => {
      setSessionUserState(getSessionUser())
    }
    handleSessionUpdate()
    window.addEventListener("storage", handleSessionUpdate)
    window.addEventListener("sims-session-update", handleSessionUpdate)
    return () => {
      window.removeEventListener("storage", handleSessionUpdate)
      window.removeEventListener("sims-session-update", handleSessionUpdate)
    }
  }, [])

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
    filterNavItems(navData.merchantSuccess, pageAccess, isSuperAdmin)
  )
  const salesItems = markActive(
    filterNavItems(navData.sales, pageAccess, isSuperAdmin)
  )
  const renewalItems = markActive(
    filterNavItems(navData.renewalRetention, pageAccess, isSuperAdmin)
  )
  const generalItems = markActive(
    filterNavItems(
      navData.general.filter(
        (item) => item.title !== "User Management" || isAdminOrHigher
      ),
      pageAccess,
      isSuperAdmin
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

  const [selectedWorkspace, setSelectedWorkspace] = React.useState(() => {
    if (typeof document === "undefined") return "All"
    const match = document.cookie
      .split("; ")
      .find((c) => c.startsWith("sidebar_workspace="))
    return match ? decodeURIComponent(match.slice("sidebar_workspace=".length)) : "All"
  })

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
