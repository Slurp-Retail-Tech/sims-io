"use client"

import * as React from "react"
import Image from "next/image"
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
          {/* The real mark, not a stand-in: this is the first thing a
              merchant sees on a link that asks them to pay.

              The wordmark is fixed black, so in dark mode it sits on a light
              chip rather than vanishing into the background. Inverting it
              instead would turn the red storefront cyan. */}
          <span className="dark:bg-white inline-flex rounded-[calc(var(--radius)-2px)] dark:px-2 dark:py-1.5">
            <Image
              src="/slurp-logo-basic-03.png"
              alt="Slurp!"
              width={3576}
              height={1024}
              className="h-7 w-auto"
              priority
            />
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
