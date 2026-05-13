import { APP_TIME_ZONE } from "@/lib/app-timezone"

export function parseDate(value: string | Date) {
  if (value instanceof Date) {
    return Number.isNaN(value.valueOf()) ? null : value
  }
  const trimmed = value.trim()
  if (!trimmed) {
    return null
  }
  let normalized = trimmed
  if (/^\d{4}-\d{2}-\d{2}\s/.test(normalized)) {
    normalized = normalized.replace(" ", "T")
  }
  const hasTimeZone = /[zZ]|[+-]\d{2}:?\d{2}$/.test(normalized)
  if (!hasTimeZone) {
    normalized = `${normalized}Z`
  }
  const date = new Date(normalized)
  if (Number.isNaN(date.valueOf())) {
    return null
  }
  return date
}

export function formatDate(value: string | Date) {
  const date = parseDate(value)
  if (!date) {
    return "--"
  }
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: APP_TIME_ZONE,
  }).format(date)
}

export function formatTime(value: string | Date) {
  const date = parseDate(value)
  if (!date) {
    return "--"
  }
  const formatted = new Intl.DateTimeFormat("en-GB", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone: APP_TIME_ZONE,
  }).format(date)
  return formatted.toLowerCase()
}

export function formatDateTime(value: string | Date) {
  return `${formatDate(value)}, ${formatTime(value)}`
}

export { APP_TIME_ZONE }
