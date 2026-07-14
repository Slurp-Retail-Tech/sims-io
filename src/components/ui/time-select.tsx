"use client"

import * as React from "react"
import { format } from "date-fns"

import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

function labelForTime(value: string): string {
  const [hours, minutes] = value.split(":").map(Number)
  if (Number.isNaN(hours) || Number.isNaN(minutes)) {
    return value
  }
  return format(new Date(2000, 0, 1, hours, minutes), "h:mm a")
}

function buildTimeOptions(
  stepMinutes: number,
  startHour?: number,
  endHour?: number
): { value: string; label: string }[] {
  // Unbounded default covers the full day (00:00 through 23:30). When bounds are
  // given, the range is inclusive of the endHour slot (e.g. 8–21 ends at 21:00).
  const startMinutes = (startHour ?? 0) * 60
  const endMinutes = endHour != null ? endHour * 60 : 24 * 60 - stepMinutes
  const options: { value: string; label: string }[] = []
  for (let total = startMinutes; total <= endMinutes; total += stepMinutes) {
    const value = `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(
      total % 60
    ).padStart(2, "0")}`
    options.push({ value, label: labelForTime(value) })
  }
  return options
}

type TimeSelectProps = {
  /** Time in 24h "HH:mm" form, or "" when unset. */
  value: string
  onChange: (value: string) => void
  id?: string
  /** Granularity of the options, in minutes. Defaults to 30. */
  stepMinutes?: number
  /** Earliest selectable hour (0-23). Defaults to the start of the day. */
  startHour?: number
  /** Latest selectable hour (0-23), inclusive. Defaults to the end of the day. */
  endHour?: number
  placeholder?: string
  disabled?: boolean
}

/**
 * Select-based time picker matching the onboarding schedule page's component.
 * Covers the full day at `stepMinutes` granularity, or a bounded window when
 * `startHour`/`endHour` are given. An off-grid `value` (e.g. from legacy data)
 * is preserved as an extra option so editing never loses it.
 */
export function TimeSelect({
  value,
  onChange,
  id,
  stepMinutes = 30,
  startHour,
  endHour,
  placeholder = "Select time",
  disabled,
}: TimeSelectProps) {
  const options = React.useMemo(
    () => buildTimeOptions(stepMinutes, startHour, endHour),
    [stepMinutes, startHour, endHour]
  )
  const offGridValue =
    value && !options.some((option) => option.value === value) ? value : null

  return (
    <Select
      value={value || undefined}
      onValueChange={onChange}
      disabled={disabled}
    >
      <SelectTrigger id={id}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        <SelectGroup>
          <SelectLabel>Time</SelectLabel>
          {offGridValue ? (
            <SelectItem value={offGridValue}>{labelForTime(offGridValue)}</SelectItem>
          ) : null}
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  )
}
