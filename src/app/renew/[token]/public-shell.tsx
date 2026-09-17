"use client"

import * as React from "react"
import { Lock } from "lucide-react"

/**
 * The frame every merchant-facing renewal page sits in: the Slurp mark on the
 * left, the "secure link" reassurance on the right, a single centred column.
 *
 * No app chrome. The merchant is not a SIMS user and must never see the
 * sidebar, the search box, or anything that implies an account.
 */
export function PublicShell({
  children,
  maxWidth = "44rem",
}: {
  children: React.ReactNode
  maxWidth?: string
}) {
  return (
    <div className="bg-background text-foreground min-h-svh px-5 pt-10 pb-24">
      <div className="mx-auto flex flex-col gap-5" style={{ maxWidth }}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span className="flex items-center gap-2.5">
            <span className="bg-primary text-primary-foreground flex size-7 items-center justify-center rounded-[var(--radius)] text-[11px] font-semibold">
              S
            </span>
            <span className="text-[0.9375rem] font-semibold">Slurp</span>
          </span>
          <span className="text-muted-foreground inline-flex items-center gap-1.5 text-[0.8125rem]">
            <Lock className="size-3.5" />
            Secure renewal link
          </span>
        </div>
        {children}
      </div>
    </div>
  )
}

/** The unusable-link state, shared by both pages. */
export function InvalidLink({ title, body }: { title: string; body: string }) {
  return (
    <div className="bg-card rounded-[calc(var(--radius)+4px)] border p-6 text-center">
      <div className="text-lg font-semibold tracking-tight">{title}</div>
      <p className="text-muted-foreground mx-auto mt-1.5 max-w-md text-sm text-pretty">{body}</p>
    </div>
  )
}

export function LoadingCard({ label }: { label: string }) {
  return (
    <div className="bg-card text-muted-foreground rounded-[calc(var(--radius)+4px)] border p-6 text-center text-sm">
      {label}
    </div>
  )
}
