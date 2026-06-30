import { AppAuthGate } from "@/components/app-auth-gate"
import { AppHeader } from "@/components/app-header"
import { AppSidebar } from "@/components/app-sidebar"
import { BreadcrumbLabelProvider } from "@/components/breadcrumb-context"
import { ToastProvider } from "@/components/toast-provider"
import {
  SidebarInset,
  SidebarProvider,
  SidebarRail,
} from "@/components/ui/sidebar"
import { cookies } from "next/headers"

const SIDEBAR_COOKIE_NAME = "sidebar_state"

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const cookieStore = await cookies()
  const sidebarState = cookieStore.get(SIDEBAR_COOKIE_NAME)?.value
  const defaultOpen = sidebarState !== "false"

  return (
    <AppAuthGate>
      <ToastProvider>
        <SidebarProvider defaultOpen={defaultOpen}>
          <AppSidebar />
          <SidebarRail />
          <SidebarInset className="bg-background/85 backdrop-blur">
            <BreadcrumbLabelProvider>
              <AppHeader />
              <div className="flex flex-1 flex-col gap-6 px-4 py-6 md:px-6">
                {children}
              </div>
            </BreadcrumbLabelProvider>
          </SidebarInset>
        </SidebarProvider>
      </ToastProvider>
    </AppAuthGate>
  )
}
