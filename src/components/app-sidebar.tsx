"use client"

import * as React from "react"
import {
  AlertTriangle,
  BarChart3,
  BookOpen,
  CalendarCheck2,
  CalendarClock,
  CalendarRange,
  ClipboardCheck,
  ClipboardList,
  LayoutDashboard,
  ListTree,
  MapPinned,
  MessageSquare,
  Ticket,
  Users,
  UserPlus,
  Store,
} from "lucide-react"
import type { LucideIcon } from "lucide-react"
import { usePathname } from "next/navigation"
import Image from "next/image"

import { NavMain } from "@/components/nav-main"
import { NavUser } from "@/components/nav-user"
import { getSessionUser } from "@/lib/session"
import {
  GENERAL_OVERVIEW_PATH,
  hasPageAccessForPath,
} from "@/lib/page-access"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar"

type NavItem = {
  title: string
  url: string
  icon: LucideIcon
  isActive?: boolean
  items?: {
    title: string
    url: string
    isActive?: boolean
  }[]
}

const data = {
  merchantSuccess: [
    {
      title: "Overview",
      url: "/merchant-success/overview",
      icon: LayoutDashboard,
    },
    {
      title: "Tickets",
      url: "/merchant-success/tickets",
      icon: Ticket,
    },
    {
      title: "ClickUp Tasks",
      url: "/merchant-success/clickup-tasks",
      icon: ClipboardCheck,
    },
    {
      title: "Ticket Categories",
      url: "/merchant-success/ticket-categories",
      icon: ListTree,
    },
    {
      title: "Audit Trail",
      url: "/merchant-success/audit-trail",
      icon: ClipboardList,
    },
    {
      title: "Analytics",
      url: "/merchant-success/analytics",
      icon: BarChart3,
      items: [
        {
          title: "Overview",
          url: "/merchant-success/analytics",
        },
        {
          title: "Tickets",
          url: "/merchant-success/analytics/tickets",
        },
        {
          title: "Issue",
          url: "/merchant-success/analytics/issue",
        },
        {
          title: "Merchant Frequency",
          url: "/merchant-success/analytics/merchant-frequency",
        },
        {
          title: "MS",
          url: "/merchant-success/analytics/ms",
        },
      ],
    },
    {
      title: "CSAT Insights",
      url: "/merchant-success/csat-insights",
      icon: MessageSquare,
    },
    {
      title: "SLA Breaches",
      url: "/merchant-success/sla-breaches",
      icon: AlertTriangle,
    },
    {
      title: "Onboarding Schedule",
      url: "/merchant-success/onboarding-schedule",
      icon: CalendarRange,
    },
  ] satisfies NavItem[],
  sales: [
    {
      title: "Overview",
      url: "/sales/overview",
      icon: LayoutDashboard,
    },
    {
      title: "Leads",
      url: "/sales/leads",
      icon: UserPlus,
    },
    {
      title: "Analytics",
      url: "/sales/analytics",
      icon: BarChart3,
    },
    {
      title: "Sales Appointment",
      url: "/sales/appointments",
      icon: CalendarCheck2,
    },
  ] satisfies NavItem[],
  renewalRetention: [
    {
      title: "Overview",
      url: "/renewal-retention/overview",
      icon: LayoutDashboard,
    },
    {
      title: "Analytics",
      url: "/renewal-retention/analytics",
      icon: BarChart3,
    },
    {
      title: "Renewal Due",
      url: "/renewal-retention/renewal-due",
      icon: CalendarClock,
    },
  ] satisfies NavItem[],
  general: [
    {
      title: "Overview",
      url: GENERAL_OVERVIEW_PATH,
      icon: LayoutDashboard,
    },
    {
      title: "Merchants",
      url: "/merchants",
      icon: Store,
    },
    {
      title: "Merchant Coverage Map",
      url: "/maps",
      icon: MapPinned,
    },
    {
      title: "PLUS",
      url: "/plus",
      icon: Store,
    },
    {
      title: "Knowledge Base",
      url: "/knowledge-base",
      icon: BookOpen,
    },
    {
      title: "User Management",
      url: "/user-management",
      icon: Users,
    },
  ] satisfies NavItem[],
}

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
    filterNavItems(data.merchantSuccess, pageAccess, isSuperAdmin)
  )
  const salesItems = markActive(
    filterNavItems(data.sales, pageAccess, isSuperAdmin)
  )
  const renewalItems = markActive(
    filterNavItems(data.renewalRetention, pageAccess, isSuperAdmin)
  )
  const generalItems = markActive(
    filterNavItems(
      data.general.filter(
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
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        {visibleDepartments.map((group) => (
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
