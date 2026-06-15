"use client"

import * as React from "react"
import { Search } from "lucide-react"
import { usePathname } from "next/navigation"

import { GlobalSearch } from "@/components/global-search"
import { ThemeToggle } from "@/components/theme-toggle"
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb"
import { GENERAL_OVERVIEW_PATH } from "@/lib/page-access"
import { Separator } from "@/components/ui/separator"
import { SidebarTrigger } from "@/components/ui/sidebar"

const breadcrumbLabels: Record<string, string> = {
  "merchant-success": "Merchant Success",
  sales: "Sales & Marketing",
  "renewal-retention": "Renewal & Retention",
  tickets: "Tickets",
  leads: "Leads",
  form: "Form",
  analytics: "Analytics",
  overview: "Overview",
  "sla-breaches": "SLA Breaches",
  appointments: "Sales Appointment",
  "renewal-due": "Renewal Due",
  merchants: "Merchants",
  maps: "Merchant Coverage Map",
  plus: "PLUS",
  "onboarding-appointments": "Onboarding Schedule",
  "onboarding-schedule": "Onboarding Schedule",
  "knowledge-base": "Knowledge Base",
  "ticket-categories": "Ticket Categories",
  "clickup-tasks": "ClickUp Tasks",
  "audit-trail": "Audit Trail",
  "csat-insights": "CSAT Insights",
  "user-management": "User Management",
  profile: "Profile",
  preferences: "Preferences",
}

const groupOverviewRoutes: Record<string, string> = {
  "merchant-success": "/merchant-success/overview",
  sales: "/sales/overview",
  "renewal-retention": "/renewal-retention/overview",
}

const generalSegments = new Set([
  "merchants",
  "maps",
  "plus",
  "knowledge-base",
  "user-management",
  "profile",
  "preferences",
])

export function AppHeader() {
  const pathname = usePathname()
  const [searchOpen, setSearchOpen] = React.useState(false)
  const [searchSeed, setSearchSeed] = React.useState("")

  React.useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault()
        setSearchSeed("")
        setSearchOpen((prev) => !prev)
      }
    }
    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [])

  const openSearch = React.useCallback((seed: string) => {
    setSearchSeed(seed)
    setSearchOpen(true)
  }, [])
  const segments = pathname.split("/").filter(Boolean)
  const baseCrumbs = segments.map((segment, index) => {
    const href =
      index === 0 && groupOverviewRoutes[segment]
        ? groupOverviewRoutes[segment]
        : `/${segments.slice(0, index + 1).join("/")}`
    const label =
      breadcrumbLabels[segment] ??
      segment.replace(/-/g, " ").replace(/\b\w/g, (char) => char.toUpperCase())
    return { href, label }
  })
  const breadcrumbs =
    segments.length > 0 &&
    !groupOverviewRoutes[segments[0]] &&
    generalSegments.has(segments[0])
      ? [{ href: GENERAL_OVERVIEW_PATH, label: "General" }, ...baseCrumbs]
      : baseCrumbs
  return (
    <header className="sticky top-0 z-20 flex h-16 items-center gap-3 rounded-2xl border-b bg-background/80 px-4 backdrop-blur">
      <SidebarTrigger className="-ml-1" />
      <Separator orientation="vertical" className="h-5" />
      <div className="flex min-w-0 flex-col">
        <Breadcrumb>
          <BreadcrumbList className="text-muted-foreground text-[14px]">
            {breadcrumbs.map((crumb, index) => (
              <React.Fragment key={`${crumb.href}-${index}`}>
                {index > 0 ? <BreadcrumbSeparator /> : null}
                <BreadcrumbItem>
                  {index === breadcrumbs.length - 1 ? (
                    <BreadcrumbPage>{crumb.label}</BreadcrumbPage>
                  ) : (
                    <BreadcrumbLink href={crumb.href}>
                      {crumb.label}
                    </BreadcrumbLink>
                  )}
                </BreadcrumbItem>
              </React.Fragment>
            ))}
          </BreadcrumbList>
        </Breadcrumb>
      </div>
      <div className="ml-auto flex items-center gap-2">
        <button
          type="button"
          onClick={() => openSearch("")}
          onKeyDown={(event) => {
            if (event.key.length === 1 && !event.metaKey && !event.ctrlKey && !event.altKey) {
              event.preventDefault()
              openSearch(event.key)
            }
          }}
          className="border-input bg-background text-muted-foreground hover:bg-accent hover:text-accent-foreground relative hidden h-9 w-72 items-center rounded-md border pl-9 pr-3 text-left text-sm transition-colors md:flex"
        >
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2" />
          <span className="flex-1 truncate">Search pages and merchants</span>
          <kbd className="bg-muted text-muted-foreground pointer-events-none ml-2 hidden items-center gap-1 rounded border px-1.5 font-mono text-[10px] font-medium lg:inline-flex">
            ⌘K
          </kbd>
        </button>
        <ThemeToggle />
      </div>
      <GlobalSearch
        open={searchOpen}
        onOpenChange={setSearchOpen}
        initialQuery={searchSeed}
      />
    </header>
  )
}
