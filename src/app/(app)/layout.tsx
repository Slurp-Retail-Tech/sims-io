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
import { requireServerSession } from "@/lib/auth-server"
import { cookies } from "next/headers"

const SIDEBAR_COOKIE_NAME = "sidebar_state"
const SIDEBAR_WORKSPACE_COOKIE_NAME = "sidebar_workspace"

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode
}) {
  // Defense in depth: authenticate on the server before rendering anything.
  // Layouts cannot see the pathname, so per-page authorization lives in the
  // requirePageAccess guards inside each page's data layer.
  const user = await requireServerSession()

  const cookieStore = await cookies()
  const sidebarState = cookieStore.get(SIDEBAR_COOKIE_NAME)?.value
  const defaultOpen = sidebarState !== "false"
  const sidebarWorkspace =
    cookieStore.get(SIDEBAR_WORKSPACE_COOKIE_NAME)?.value || "All"

  return (
    <AppAuthGate initialUser={user}>
      <ToastProvider>
        <SidebarProvider defaultOpen={defaultOpen}>
          <AppSidebar initialUser={user} initialWorkspace={sidebarWorkspace} />
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
