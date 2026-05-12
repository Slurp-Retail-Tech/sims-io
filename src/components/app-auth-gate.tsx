"use client"

import * as React from "react"
import { usePathname, useRouter } from "next/navigation"

import {
  clearSession,
  getSessionState,
  setSessionUser,
  type SessionUser,
} from "@/lib/session"
import { hasPageAccessForPath } from "@/lib/page-access"

export function AppAuthGate({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const pathname = usePathname()
  const [checking, setChecking] = React.useState(true)
  const [hasSession, setHasSession] = React.useState(false)
  const [verifiedPath, setVerifiedPath] = React.useState<string | null>(null)

  React.useEffect(() => {
    let cancelled = false

    const validateUser = (user: SessionUser | null) => {
      if (cancelled) {
        return
      }
      if (!user) {
        setHasSession(false)
        setVerifiedPath(null)
        setChecking(false)
        router.replace("/login")
        return
      }
      if (user.role === "Super Admin") {
        setHasSession(true)
        setVerifiedPath(pathname)
        setChecking(false)
        return
      }

      const pageAccess = user.pageAccess ?? []
      const hasAccess = hasPageAccessForPath(pathname, pageAccess)
      if (!hasAccess) {
        router.replace("/overview")
        return
      }

      setHasSession(true)
      setVerifiedPath(pathname)
      setChecking(false)
    }

    const validateServerSession = async () => {
      setChecking(true)
      setHasSession(false)
      setVerifiedPath(null)

      try {
        const response = await fetch("/api/auth/session", {
          credentials: "same-origin",
        })

        if (response.status === 401) {
          clearSession()
          validateUser(null)
          return
        }

        if (!response.ok) {
          clearSession()
          validateUser(null)
          return
        }

        const data = (await response.json()) as { user?: SessionUser }
        if (!data.user) {
          clearSession()
          validateUser(null)
          return
        }

        const remember = getSessionState()?.remember ?? false
        setSessionUser(data.user, remember)
        validateUser(data.user)
      } catch {
        clearSession()
        validateUser(null)
      }
    }

    void validateServerSession()

    return () => {
      cancelled = true
    }
  }, [pathname, router])

  if (checking) {
    return (
      <div className="text-muted-foreground flex min-h-svh items-center justify-center text-sm">
        Checking session...
      </div>
    )
  }

  if (!hasSession || verifiedPath !== pathname) {
    return null
  }

  return <>{children}</>
}
