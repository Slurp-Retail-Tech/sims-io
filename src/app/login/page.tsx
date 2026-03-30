import type { Metadata } from "next"
import { Suspense } from "react"
import Image from "next/image"

import { LoginForm } from "@/components/login-form"
import { ThemeToggle } from "@/components/theme-toggle"

export const metadata: Metadata = {
  title: "Login",
}

export default function LoginPage() {
  return (
    <div className="relative min-h-svh overflow-hidden">
      <div className="absolute right-6 top-6">
        <ThemeToggle />
      </div>
      <div className="animate-in fade-in slide-in-from-bottom-2 relative mx-auto grid min-h-svh max-w-5xl items-center gap-10 px-6 py-12 md:grid-cols-[1.1fr_0.9fr]">
        <div className="space-y-6">
          <div className="flex items-center gap-3">
            <Image
              src="/system-logo-v2.png"
              alt="SIMS"
              width={28}
              height={28}
              className="h-7 w-7"
              priority
            />
            <span className="text-sm font-medium">SIMS</span>
          </div>
          <div className="space-y-3">
            <h1 className="text-3xl font-semibold tracking-tight md:text-4xl">
              Modern support, sales, and renewals in one workspace.
            </h1>
            <p className="text-muted-foreground text-sm leading-relaxed">
              Bring every merchant conversation into a calm, focused console.
              Track SLAs, renewals, and CSAT with full outlet context.
            </p>
          </div>
          <div className="grid gap-3 text-sm text-muted-foreground">
            <div className="rounded-xl border bg-card/80 px-4 py-3">
              Live ticket queue with collision control and SLA timers.
            </div>
            <div className="rounded-xl border bg-card/80 px-4 py-3">
              Renewal reminders automated from POS expiry dates.
            </div>
            <div className="rounded-xl border bg-card/80 px-4 py-3">
              CSAT captured and aggregated per outlet and agent.
            </div>
          </div>
        </div>
        <div className="w-full">
          <Suspense fallback={<div className="min-h-96 rounded-xl border bg-card/90 shadow-lg" />}>
            <LoginForm />
          </Suspense>
        </div>
      </div>
      <div className="text-muted-foreground absolute bottom-6 left-1/2 -translate-x-1/2 text-xs">
        Made with ❤️ by <span className="font-semibold italic">Slurp!</span>
      </div>
    </div>
  )
}
