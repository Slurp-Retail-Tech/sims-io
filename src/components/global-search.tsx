"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { Loader2, Store } from "lucide-react"

import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command"
import { getSessionUser } from "@/lib/session"
import { hasPageAccessForPath } from "@/lib/page-access"
import { navData, type NavItem } from "@/lib/nav-items"

type PageResult = {
  title: string
  url: string
  icon: NavItem["icon"]
  groupLabel: string
}

type MerchantOption = {
  id: string
  name: string
  fid: string | null
  externalId: string
  company: string | null
}

const navGroups: { label: string; items: NavItem[] }[] = [
  { label: "Merchant Success", items: navData.merchantSuccess },
  { label: "Sales & Marketing", items: navData.sales },
  { label: "Renewal & Retention", items: navData.renewalRetention },
  { label: "General", items: navData.general },
]

function flattenNavItems(): PageResult[] {
  const results: PageResult[] = []
  for (const group of navGroups) {
    for (const item of group.items) {
      results.push({
        title: item.title,
        url: item.url,
        icon: item.icon,
        groupLabel: group.label,
      })
      for (const subItem of item.items ?? []) {
        results.push({
          title: `${item.title} · ${subItem.title}`,
          url: subItem.url,
          icon: item.icon,
          groupLabel: group.label,
        })
      }
    }
  }
  return results
}

type GlobalSearchProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  initialQuery?: string
}

export function GlobalSearch({
  open,
  onOpenChange,
  initialQuery = "",
}: GlobalSearchProps) {
  const router = useRouter()
  const [query, setQuery] = React.useState(initialQuery)
  const [merchants, setMerchants] = React.useState<MerchantOption[]>([])
  const [merchantsLoading, setMerchantsLoading] = React.useState(false)
  const [sessionUser, setSessionUser] = React.useState(() => getSessionUser())

  React.useEffect(() => {
    const handleSessionUpdate = () => setSessionUser(getSessionUser())
    handleSessionUpdate()
    window.addEventListener("storage", handleSessionUpdate)
    window.addEventListener("sims-session-update", handleSessionUpdate)
    return () => {
      window.removeEventListener("storage", handleSessionUpdate)
      window.removeEventListener("sims-session-update", handleSessionUpdate)
    }
  }, [])

  // Seed the input with the keystroke that opened the dialog.
  React.useEffect(() => {
    if (open) {
      setQuery(initialQuery)
    }
  }, [open, initialQuery])

  const isSuperAdmin = sessionUser?.role === "Super Admin"
  const pageAccess = React.useMemo(
    () => sessionUser?.pageAccess ?? [],
    [sessionUser]
  )

  const pages = React.useMemo(() => {
    return flattenNavItems().filter((page) =>
      isSuperAdmin ? true : hasPageAccessForPath(page.url, pageAccess)
    )
  }, [isSuperAdmin, pageAccess])

  // Fetch merchants from the server (debounced) — server handles filtering.
  React.useEffect(() => {
    const trimmed = query.trim()
    if (!open || trimmed.length < 2) {
      setMerchants([])
      setMerchantsLoading(false)
      return
    }

    let active = true
    const controller = new AbortController()
    setMerchantsLoading(true)
    const timer = window.setTimeout(async () => {
      try {
        const response = await fetch(
          `/api/merchants/options?q=${encodeURIComponent(trimmed)}&limit=10`,
          { signal: controller.signal }
        )
        if (!response.ok) {
          throw new Error("Failed to load merchants")
        }
        const data = (await response.json()) as { merchants: MerchantOption[] }
        if (active) {
          setMerchants(data.merchants ?? [])
        }
      } catch (error) {
        if (active && !(error instanceof DOMException && error.name === "AbortError")) {
          setMerchants([])
        }
      } finally {
        if (active) {
          setMerchantsLoading(false)
        }
      }
    }, 250)

    return () => {
      active = false
      controller.abort()
      window.clearTimeout(timer)
    }
  }, [query, open])

  const handleSelect = React.useCallback(
    (url: string) => {
      onOpenChange(false)
      setQuery("")
      router.push(url)
    },
    [onOpenChange, router]
  )

  const trimmedQuery = query.trim()
  const showMerchantGroup = trimmedQuery.length >= 2
  const filteredPages = React.useMemo(
    () =>
      pages.filter((page) =>
        trimmedQuery.length === 0
          ? true
          : page.title.toLowerCase().includes(trimmedQuery.toLowerCase())
      ),
    [pages, trimmedQuery]
  )

  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      shouldFilter={false}
    >
      <CommandInput
        placeholder="Search pages and merchants..."
        value={query}
        onValueChange={setQuery}
      />
      <CommandList>
        <CommandEmpty>No results found.</CommandEmpty>
        {filteredPages.length > 0 ? (
          <CommandGroup heading="Pages">
            {filteredPages.map((page) => {
              const Icon = page.icon
              return (
                <CommandItem
                  key={page.url}
                  value={`page:${page.url}`}
                  onSelect={() => handleSelect(page.url)}
                >
                  <Icon />
                  <span>{page.title}</span>
                  <span className="text-muted-foreground ml-auto text-xs">
                    {page.groupLabel}
                  </span>
                </CommandItem>
              )
            })}
          </CommandGroup>
        ) : null}
        {showMerchantGroup ? (
          <>
            {filteredPages.length > 0 ? <CommandSeparator /> : null}
            <CommandGroup heading="Merchants">
              {merchantsLoading ? (
                <div className="text-muted-foreground flex items-center gap-2 px-2 py-3 text-sm">
                  <Loader2 className="size-4 animate-spin" />
                  Searching merchants...
                </div>
              ) : merchants.length === 0 ? (
                <div className="text-muted-foreground px-2 py-3 text-sm">
                  No merchants found.
                </div>
              ) : (
                merchants.map((merchant) => {
                  const target = merchant.fid
                    ? `/merchants/${encodeURIComponent(merchant.fid)}`
                    : `/merchants?q=${encodeURIComponent(merchant.name)}`
                  return (
                    <CommandItem
                      key={merchant.id}
                      value={`merchant:${merchant.id}`}
                      onSelect={() => handleSelect(target)}
                    >
                      <Store />
                      <span className="truncate">{merchant.name}</span>
                      {merchant.fid ? (
                        <span className="text-muted-foreground ml-auto text-xs">
                          {merchant.fid}
                        </span>
                      ) : null}
                    </CommandItem>
                  )
                })
              )}
            </CommandGroup>
          </>
        ) : null}
      </CommandList>
    </CommandDialog>
  )
}
