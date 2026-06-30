import {
  AlertTriangle,
  BarChart3,
  BookOpen,
  CalendarCheck2,
  CalendarClock,
  CalendarRange,
  ClipboardCheck,
  ClipboardList,
  Handshake,
  LayoutDashboard,
  ListTree,
  MapPinned,
  MessageSquare,
  Store,
  Ticket,
  UserPlus,
  Users,
} from "lucide-react"
import type { LucideIcon } from "lucide-react"

import { GENERAL_OVERVIEW_PATH } from "@/lib/page-access"

export type NavSubItem = {
  title: string
  url: string
  isActive?: boolean
}

export type NavItem = {
  title: string
  url: string
  icon: LucideIcon
  isActive?: boolean
  items?: NavSubItem[]
}

export type NavGroup = {
  label: string
  items: NavItem[]
}

export const merchantSuccessNav: NavItem[] = [
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
]

export const salesNav: NavItem[] = [
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
    title: "Deals",
    url: "/sales/deals",
    icon: Handshake,
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
]

export const renewalRetentionNav: NavItem[] = [
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
]

export const generalNav: NavItem[] = [
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
]

export const navData = {
  merchantSuccess: merchantSuccessNav,
  sales: salesNav,
  renewalRetention: renewalRetentionNav,
  general: generalNav,
}
