"use client"

import * as React from "react"

type BreadcrumbLabelContextValue = {
  labels: Record<string, string>
  setLabel: (href: string, label: string) => void
  clearLabel: (href: string) => void
}

const BreadcrumbLabelContext =
  React.createContext<BreadcrumbLabelContextValue | null>(null)

/**
 * Holds per-href breadcrumb label overrides so detail pages can replace the
 * raw URL segment (e.g. a lead id) with a friendlier label (the lead name).
 */
export function BreadcrumbLabelProvider({
  children,
}: {
  children: React.ReactNode
}) {
  const [labels, setLabels] = React.useState<Record<string, string>>({})

  const setLabel = React.useCallback((href: string, label: string) => {
    setLabels((current) =>
      current[href] === label ? current : { ...current, [href]: label }
    )
  }, [])

  const clearLabel = React.useCallback((href: string) => {
    setLabels((current) => {
      if (!(href in current)) {
        return current
      }
      const next = { ...current }
      delete next[href]
      return next
    })
  }, [])

  const value = React.useMemo(
    () => ({ labels, setLabel, clearLabel }),
    [labels, setLabel, clearLabel]
  )

  return (
    <BreadcrumbLabelContext.Provider value={value}>
      {children}
    </BreadcrumbLabelContext.Provider>
  )
}

/** Returns the current map of href → override label (empty when no provider). */
export function useBreadcrumbLabels(): Record<string, string> {
  return React.useContext(BreadcrumbLabelContext)?.labels ?? {}
}

/**
 * Registers a breadcrumb label override for `href` while the calling component
 * is mounted. The override is cleared on unmount or when the inputs change.
 */
export function useSetBreadcrumbLabel(href: string, label: string | null) {
  const context = React.useContext(BreadcrumbLabelContext)

  React.useEffect(() => {
    if (!context || !label) {
      return
    }
    context.setLabel(href, label)
    return () => context.clearLabel(href)
  }, [context, href, label])
}
