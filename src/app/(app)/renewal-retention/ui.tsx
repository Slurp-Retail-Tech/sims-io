"use client"

import * as React from "react"
import Link from "next/link"

import { cn } from "@/lib/utils"

/**
 * Small shared pieces for the Renewal & Retention screens, matching the SIMS
 * Renewal design: status pills, KPI tiles, pill tabs, and the amount and date
 * formatters every screen uses.
 *
 * Amounts arrive from the API in integer minor units and are formatted here,
 * so no screen parses a decimal.
 */

export type Tone = "green" | "blue" | "amber" | "red" | "gray"

export const TONE_PILL: Record<Tone, string> = {
  green: "bg-emerald-500/15 text-emerald-800 dark:text-emerald-200",
  blue: "bg-sky-500/15 text-sky-800 dark:text-sky-200",
  amber: "bg-amber-500/15 text-amber-800 dark:text-amber-200",
  red: "bg-red-500/12 text-red-800 dark:text-red-200",
  gray: "bg-muted text-muted-foreground",
}

export const TONE_TEXT: Record<Tone, string> = {
  green: "text-emerald-700 dark:text-emerald-300",
  blue: "text-sky-700 dark:text-sky-300",
  amber: "text-amber-700 dark:text-amber-300",
  red: "text-red-700 dark:text-red-300",
  gray: "text-muted-foreground",
}

export const TONE_DOT: Record<Tone, string> = {
  green: "bg-emerald-600",
  blue: "bg-sky-600",
  amber: "bg-amber-600",
  red: "bg-red-600",
  gray: "bg-muted-foreground/60",
}

export function Pill({
  tone = "gray",
  children,
  className,
  mono,
}: {
  tone?: Tone
  children: React.ReactNode
  className?: string
  mono?: boolean
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap",
        TONE_PILL[tone],
        mono && "font-mono font-medium",
        className
      )}
    >
      {children}
    </span>
  )
}

export function OutlinePill({ children }: { children: React.ReactNode }) {
  return (
    <span className="text-muted-foreground inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] whitespace-nowrap">
      {children}
    </span>
  )
}

/** Invoice status → pill tone, per the design's INVOICE_TONE table. */
export const INVOICE_STATUS_TONE: Record<string, Tone> = {
  draft: "gray",
  issued: "blue",
  sent: "blue",
  payment_pending: "amber",
  paid: "green",
  lapsed: "red",
  cancelled: "gray",
  superseded: "gray",
}

export const INVOICE_STATUS_LABEL: Record<string, string> = {
  draft: "Draft",
  issued: "Issued",
  sent: "Sent",
  payment_pending: "Payment pending",
  paid: "Paid",
  lapsed: "Lapsed",
  cancelled: "Voided",
  superseded: "Superseded",
}

export const TERM_LABEL: Record<string, string> = {
  annually: "1 year",
  bi_annually: "6 months",
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

/** `RM 8,400.00`, spaced as the design writes it. */
export function money(minor: number | null | undefined, currency = "MYR"): string {
  if (minor === null || minor === undefined) {
    return "—"
  }
  const negative = minor < 0
  const absolute = Math.abs(minor)
  const whole = String(Math.trunc(absolute / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, ",")
  const prefix = currency === "MYR" ? "RM " : `${currency} `
  return `${negative ? "−" : ""}${prefix}${whole}.${String(absolute % 100).padStart(2, "0")}`
}

/** Signed, for adjustments: `−RM 240.00`, `+RM 180.00`, or `—` for none. */
export function signedMoney(minor: number | null | undefined, currency = "MYR"): string {
  if (!minor) {
    return "—"
  }
  return `${minor < 0 ? "−" : "+"}${money(Math.abs(minor), currency)}`
}

/** `2026-10-02` → `2 Oct 2026`. Read literally, never through `Date`. */
export function longDate(value: string | null | undefined): string {
  if (!value) {
    return "—"
  }
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value)
  if (!match) {
    return value
  }
  return `${Number(match[3])} ${MONTHS[Number(match[2]) - 1] ?? match[2]} ${match[1]}`
}

/** A UTC DATETIME(3) from the pool as `2 Sep · 06:00` in Kuala Lumpur. */
export function shortDateTime(value: string | null | undefined): string {
  if (!value) {
    return "—"
  }
  const iso = value.includes("T") ? value : `${value.replace(" ", "T")}Z`
  const date = new Date(iso)
  if (Number.isNaN(date.valueOf())) {
    return value
  }
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kuala_Lumpur",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date)
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? ""
  return `${get("day")} ${get("month")} · ${get("hour")}:${get("minute")}`
}

/** Days from today (Kuala Lumpur) to a `YYYY-MM-DD`. Negative when past. */
export function daysUntil(date: string | null | undefined): number | null {
  if (!date) {
    return null
  }
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(date)
  if (!match) {
    return null
  }
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kuala_Lumpur",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date())
  const [ty, tm, td] = today.split("-").map(Number)
  const target = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
  const now = Date.UTC(ty, tm - 1, td)
  return Math.round((target - now) / 86_400_000)
}

export function daysLabel(days: number | null): { label: string; tone: Tone } {
  if (days === null) {
    return { label: "No expiry date", tone: "gray" }
  }
  if (days < 0) {
    return { label: `${Math.abs(days)} days overdue`, tone: "red" }
  }
  if (days === 0) {
    return { label: "Expires today", tone: "red" }
  }
  return { label: `${days} days to expiry`, tone: days <= 15 ? "amber" : "gray" }
}

export function plural(count: number, singular: string, pluralForm = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : pluralForm}`
}

/** The design's page header: title, one-line purpose, actions on the right. */
export function PageHeader({
  title,
  description,
  meta,
  children,
}: {
  title: string
  description: string
  /** A quiet line under the description, e.g. when the nightly check last ran. */
  meta?: React.ReactNode
  children?: React.ReactNode
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-[-0.01em]">{title}</h1>
        <p className="text-muted-foreground mt-1 text-sm text-pretty">{description}</p>
        {meta ? <div className="text-muted-foreground mt-1.5 text-xs">{meta}</div> : null}
      </div>
      {children ? <div className="flex flex-wrap items-center gap-2">{children}</div> : null}
    </div>
  )
}

export function KpiTile({
  label,
  value,
  meta,
  metaTone = "gray",
  onClick,
  href,
}: {
  label: string
  value: string
  meta?: string
  metaTone?: Tone
  onClick?: () => void
  /** Drill through to the rows behind the figure. */
  href?: string
}) {
  const body = (
    <>
      <div className="text-muted-foreground text-xs">{label}</div>
      <div className="mt-1.5 text-[1.625rem] font-semibold tracking-[-0.02em] tabular-nums">{value}</div>
      {meta ? <div className={cn("mt-1 text-xs", TONE_TEXT[metaTone])}>{meta}</div> : null}
    </>
  )
  const className = "bg-card rounded-[calc(var(--radius)+2px)] border px-4.5 py-4 text-left"
  if (href) {
    return (
      <Link href={href} className={cn(className, "hover:bg-accent/40 transition-colors")}>
        {body}
      </Link>
    )
  }
  return onClick ? (
    <button type="button" onClick={onClick} className={cn(className, "hover:bg-accent/40 cursor-pointer transition-colors")}>
      {body}
    </button>
  ) : (
    <div className={className}>{body}</div>
  )
}

export function PillTabs<T extends string>({
  tabs,
  value,
  onChange,
  size = "md",
}: {
  tabs: ReadonlyArray<{ key: T; label: string }>
  value: T
  onChange: (key: T) => void
  size?: "sm" | "md"
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {tabs.map((tab) => {
        const active = tab.key === value
        return (
          <button
            key={tab.key}
            type="button"
            onClick={() => onChange(tab.key)}
            aria-pressed={active}
            className={cn(
              "rounded-full border font-medium transition-colors",
              size === "sm" ? "px-3 py-1.5 text-xs" : "px-3.5 py-1.5 text-[0.8125rem]",
              active
                ? "border-primary bg-primary text-primary-foreground"
                : "border-border text-muted-foreground hover:bg-accent/40 bg-transparent"
            )}
          >
            {tab.label}
          </button>
        )
      })}
    </div>
  )
}

/** Uppercase column headings, as the design's tables use. */
export function ColumnHeadings({ columns, grid }: { columns: Array<{ label: string; align?: "right" }>; grid: string }) {
  return (
    <div className={cn("text-muted-foreground grid gap-3 border-b px-2 pb-2.5 text-[11px] tracking-[0.05em] uppercase", grid)}>
      {columns.map((column) => (
        <span key={column.label} className={column.align === "right" ? "text-right" : undefined}>
          {column.label}
        </span>
      ))}
    </div>
  )
}

/**
 * The nightly renewal check's status, as the list APIs return it.
 * Re-declared for the client bundle; mirrors `RunStatus` in
 * `src/lib/renewal/run-status.ts`.
 */
export type RunStatus = {
  lastStatus: "succeeded" | "failed" | null
  lastFinishedAt: string | null
  lastSucceededAt: string | null
  subscriptionsInWindow: number
  readinessWindowDays: number
  invoiceWindowDays: number
}

/**
 * "Last checked 22 Sep · 01:15", or why it cannot say.
 *
 * Says "the next nightly check" rather than a clock time on purpose: the
 * schedule lives in the platform scheduler, not in SIMS, so a hardcoded time
 * would drift from the truth the day someone moves the cron.
 */
export function RunStatusLine({ status }: { status: RunStatus | null }) {
  if (!status) {
    return null
  }
  if (status.lastSucceededAt === null) {
    return (
      <span>
        {status.lastStatus === "failed"
          ? `The nightly check has never completed. It last failed ${shortDateTime(status.lastFinishedAt)}.`
          : "Not checked yet. The first nightly check fills this in."}
      </span>
    )
  }
  if (status.lastStatus === "failed") {
    return (
      <span className="text-amber-700 dark:text-amber-400">
        The last check failed {shortDateTime(status.lastFinishedAt)}. Last good check {shortDateTime(status.lastSucceededAt)}.
      </span>
    )
  }
  return <span>Last checked {shortDateTime(status.lastSucceededAt)}. Checked again at the next nightly run.</span>
}
