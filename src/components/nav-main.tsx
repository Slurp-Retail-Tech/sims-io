"use client"

import { ChevronRight, type LucideIcon } from "lucide-react"

import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import {
  SidebarGroup,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
} from "@/components/ui/sidebar"

export function NavMain({
  label,
  items,
}: {
  label: string
  items: {
    title: string
    url: string
    icon: LucideIcon
    isActive?: boolean
    /** A live count shown beside the item; hidden when zero or absent. */
    badge?: number
    items?: {
      title: string
      url: string
      isActive?: boolean
    }[]
  }[]
}) {
  return (
    <SidebarGroup>
      <SidebarGroupLabel className="text-muted-foreground text-[12px] font-semibold">
        {label}
      </SidebarGroupLabel>
      <div className="relative mt-2 pl-3 before:absolute before:left-1 before:top-1 before:bottom-2 before:w-px before:bg-border/80">
        <SidebarMenu>
          {items.map((item) => (
            <Collapsible
              key={item.title}
              className="group/collapsible"
              defaultOpen={item.isActive}
            >
              <SidebarMenuItem>
              {item.items?.length ? (
                <CollapsibleTrigger asChild>
                  <SidebarMenuButton
                    tooltip={item.title}
                    isActive={item.isActive}
                    className="justify-between"
                    type="button"
                  >
                    <span className="flex items-center gap-2">
                      <item.icon className="size-4" />
                      <span>{item.title}</span>
                    </span>
                    <ChevronRight className="size-4 transition-transform group-data-[state=open]/collapsible:rotate-90" />
                  </SidebarMenuButton>
                </CollapsibleTrigger>
              ) : (
                <SidebarMenuButton
                  asChild
                  tooltip={item.title}
                  isActive={item.isActive}
                >
                  <a href={item.url}>
                    <item.icon />
                    <span>{item.title}</span>
                  </a>
                </SidebarMenuButton>
              )}
              {item.badge && item.badge > 0 ? (
                <SidebarMenuBadge
                  className="bg-destructive/10 text-destructive"
                  aria-label={`${item.badge} blocking`}
                  title={`${item.badge} blocking an invoice`}
                >
                  {item.badge > 99 ? "99+" : item.badge}
                </SidebarMenuBadge>
              ) : null}
              {item.items?.length ? (
                <CollapsibleContent>
                  <SidebarMenuSub>
                    {item.items?.map((subItem) => (
                      <SidebarMenuSubItem key={subItem.title}>
                        <SidebarMenuSubButton
                          asChild
                          isActive={subItem.isActive}
                        >
                          <a href={subItem.url}>
                            <span>{subItem.title}</span>
                          </a>
                        </SidebarMenuSubButton>
                      </SidebarMenuSubItem>
                    ))}
                  </SidebarMenuSub>
                </CollapsibleContent>
              ) : null}
              </SidebarMenuItem>
            </Collapsible>
          ))}
        </SidebarMenu>
      </div>
    </SidebarGroup>
  )
}
