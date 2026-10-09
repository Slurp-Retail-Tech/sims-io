/**
 * The renewal clock drawn on one line, for Renewal Settings.
 *
 * Four time settings govern a renewal and none of them used to be visible
 * next to the others: the readiness window (how far ahead gaps are looked
 * for), the invoicing window (how far ahead a proforma may be raised), the
 * reminder offsets, and the grace window after expiry. The invoicing window
 * is not a setting at all: since 4.27.0 it is derived from the furthest
 * reminder offset, and nothing on screen said so.
 *
 * This lays the four out as segments and markers on a day axis running from
 * the earliest day any of them reaches to the end of the grace window, with
 * expiry at day 0. Positions are percentages so the JSX only places them.
 *
 * Pure and runtime-free so the day arithmetic is unit-tested.
 */

import { invoiceWindowDays } from "./readiness.ts"

export type TimelineInput = {
  readinessWindowDays: number
  reminderOffsets: readonly number[]
  graceWindowDays: number
}

export type TimelineSegment = {
  key: "readiness" | "invoicing" | "grace"
  label: string
  detail: string
  /** Days relative to expiry; negative is before. */
  fromDay: number
  toDay: number
  fromPct: number
  toPct: number
}

export type TimelineMarker = {
  key: string
  kind: "reminder" | "expiry"
  label: string
  day: number
  pct: number
}

export type SettingsTimeline = {
  invoiceWindowDays: number
  segments: TimelineSegment[]
  markers: TimelineMarker[]
  /** Configurations that work but probably are not what was meant. */
  notes: string[]
}

const days = (count: number) => `${count} ${count === 1 ? "day" : "days"}`

/**
 * Build the timeline. Inputs are taken as whole, non-negative days; anything
 * else (a half-typed field) is clamped rather than thrown on, because the
 * timeline redraws on every keystroke.
 */
export function buildSettingsTimeline(input: TimelineInput): SettingsTimeline {
  const readiness = wholeDays(input.readinessWindowDays)
  const grace = wholeDays(input.graceWindowDays)
  const offsets = [...new Set(input.reminderOffsets.map(wholeDays))].sort((a, b) => b - a)
  const invoicing = invoiceWindowDays(offsets)

  const start = -Math.max(readiness, invoicing, 1)
  const end = Math.max(grace, 1)
  const pct = (day: number) => round(((day - start) / (end - start)) * 100)

  const segments: TimelineSegment[] = []
  if (readiness > invoicing) {
    segments.push({
      key: "readiness",
      label: "Readiness window",
      detail: `From ${days(readiness)} before expiry, missing plans and PICs are raised in Actions Required. Nothing is invoiced yet.`,
      fromDay: -readiness,
      toDay: -invoicing,
      fromPct: pct(-readiness),
      toPct: pct(-invoicing),
    })
  }
  segments.push({
    key: "invoicing",
    label: "Invoicing window",
    detail: `From ${days(invoicing)} before expiry to expiry day, the nightly check raises a proforma for any eligible outlet without one. Derived from the furthest reminder offset.`,
    fromDay: -invoicing,
    toDay: 0,
    fromPct: pct(-invoicing),
    toPct: pct(0),
  })
  if (grace > 0) {
    segments.push({
      key: "grace",
      label: "Grace window",
      detail: `For ${days(grace)} after expiry the link stays payable, and a payment still renews from the original expiry date.`,
      fromDay: 0,
      toDay: grace,
      fromPct: pct(0),
      toPct: pct(grace),
    })
  }

  const markers: TimelineMarker[] = [
    ...offsets.map((offset) => ({
      key: `reminder-${offset}`,
      kind: "reminder" as const,
      label: offset === 0 ? "T-0" : `T-${offset}`,
      day: -offset,
      pct: pct(-offset),
    })),
    { key: "expiry", kind: "expiry", label: "Expiry", day: 0, pct: pct(0) },
  ]

  const notes: string[] = []
  if (readiness > 0 && readiness <= invoicing) {
    notes.push(
      `The readiness window (${days(readiness)}) ends inside the invoicing window (${days(invoicing)}), so it gives no warning before an invoice would be raised.`
    )
  }
  if (offsets.length > 0 && invoicing === 0) {
    notes.push("The only reminder is on expiry day, so a proforma is raised on expiry day and not before.")
  }

  return { invoiceWindowDays: invoicing, segments, markers, notes }
}

function wholeDays(value: number): number {
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0
}

function round(value: number): number {
  return Math.round(value * 100) / 100
}
