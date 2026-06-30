"use client"

import * as React from "react"
import { format, isValid, parse } from "date-fns"
import { CalendarIcon } from "lucide-react"

import { cn } from "@/lib/utils"
import Calendar04 from "@/components/calendar-04"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"

const DATE_FORMAT = "yyyy-MM-dd"
const DATETIME_FORMAT = "yyyy-MM-dd'T'HH:mm"
const DEFAULT_TIME = "09:00"

type DateTimePickerMode = "date" | "datetime"

type DateTimePickerProps = {
  /** "yyyy-MM-dd" in date mode, "yyyy-MM-ddTHH:mm" in datetime mode. "" when empty. */
  value: string
  onChange: (value: string) => void
  mode?: DateTimePickerMode
  id?: string
  disabled?: boolean
  placeholder?: string
}

function parseValue(value: string, mode: DateTimePickerMode): Date | null {
  if (!value) {
    return null
  }
  const parsed = parse(value, mode === "datetime" ? DATETIME_FORMAT : DATE_FORMAT, new Date())
  return isValid(parsed) ? parsed : null
}

export function DateTimePicker({
  value,
  onChange,
  mode = "date",
  id,
  disabled,
  placeholder = "Select date",
}: DateTimePickerProps) {
  const [open, setOpen] = React.useState(false)
  const selectedDate = parseValue(value, mode)
  const timeValue = selectedDate ? format(selectedDate, "HH:mm") : ""

  const emit = (date: Date, time: string) => {
    if (mode !== "datetime") {
      onChange(format(date, DATE_FORMAT))
      return
    }
    const [hours, minutes] = time.split(":")
    const next = new Date(date)
    next.setHours(Number(hours) || 0, Number(minutes) || 0, 0, 0)
    onChange(format(next, DATETIME_FORMAT))
  }

  const handleSelect = (date: Date | undefined) => {
    if (!date) {
      return
    }
    emit(date, mode === "datetime" ? timeValue || DEFAULT_TIME : "")
    if (mode === "date") {
      setOpen(false)
    }
  }

  const handleTimeChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    emit(selectedDate ?? new Date(), event.target.value || DEFAULT_TIME)
  }

  const label = selectedDate
    ? format(selectedDate, mode === "datetime" ? "dd MMM yyyy · HH:mm" : "dd MMM yyyy")
    : placeholder

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          id={id}
          type="button"
          variant="outline"
          disabled={disabled}
          className={cn(
            "w-full justify-between text-left font-normal",
            !selectedDate && "text-muted-foreground"
          )}
        >
          <span className="flex items-center gap-2">
            <CalendarIcon className="size-4" />
            {label}
          </span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-auto p-0">
        <Calendar04
          mode="single"
          selected={selectedDate ?? undefined}
          onSelect={handleSelect}
          defaultMonth={selectedDate ?? undefined}
        />
        {mode === "datetime" ? (
          <div className="border-t p-3">
            <Input
              type="time"
              aria-label="Time"
              value={timeValue}
              onChange={handleTimeChange}
            />
          </div>
        ) : null}
      </PopoverContent>
    </Popover>
  )
}
