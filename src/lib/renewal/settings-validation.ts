/**
 * Validating a change to the renewal settings.
 *
 * Every field is optional: the page sends what changed. Each accepted value is
 * normalised into what the column stores, and every rejection names the field
 * so the form can point at it.
 *
 * Pure and runtime-free so the rules are unit-tested under `node --test`.
 */

import type { BillingTerm } from "./plan-resolution.ts"

export type SettingsPatchInput = {
  reminderOffsets?: unknown
  readinessWindowDays?: unknown
  defaultBillingPlan?: unknown
  taxRatePercent?: unknown
  overrideVarianceThresholdPct?: unknown
  graceWindowDays?: unknown
  dispatchEnabled?: unknown
  sendWindowStart?: unknown
  sendWindowEnd?: unknown
  sessionExpiryMinutes?: unknown
  maxSessionRetries?: unknown
  receiptPollCeilingSeconds?: unknown
  respondioWhatsappChannelId?: unknown
  bukkuDescriptionFormat?: unknown
  sellerName?: unknown
  sellerRegistrationNo?: unknown
  sellerAddress?: unknown
  sellerContact?: unknown
}

export type SettingsPatch = {
  reminderOffsets?: number[]
  readinessWindowDays?: number
  defaultBillingPlan?: BillingTerm
  taxRatePercent?: number
  overrideVarianceThresholdPct?: number
  graceWindowDays?: number
  dispatchEnabled?: boolean
  sendWindowStart?: string
  sendWindowEnd?: string
  sessionExpiryMinutes?: number
  maxSessionRetries?: number
  receiptPollCeilingSeconds?: number
  respondioWhatsappChannelId?: string | null
  bukkuDescriptionFormat?: string | null
  sellerName?: string | null
  sellerRegistrationNo?: string | null
  /** Newline-separated; one printed line per line. */
  sellerAddress?: string | null
  /** Newline-separated; phone, email, website, one per line. */
  sellerContact?: string | null
}

export type FieldError = { field: string; message: string }

export type SettingsValidation =
  | { ok: true; patch: SettingsPatch }
  | { ok: false; errors: FieldError[] }

const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)(?::([0-5]\d))?$/

function integerIn(
  value: unknown,
  field: string,
  min: number,
  max: number,
  errors: FieldError[]
): number | undefined {
  const parsed = typeof value === "string" ? Number(value.trim()) : value
  if (typeof parsed !== "number" || !Number.isInteger(parsed)) {
    errors.push({ field, message: "Enter a whole number." })
    return undefined
  }
  if (parsed < min || parsed > max) {
    errors.push({ field, message: `Must be between ${min} and ${max}.` })
    return undefined
  }
  return parsed
}

function decimalIn(
  value: unknown,
  field: string,
  min: number,
  max: number,
  errors: FieldError[]
): number | undefined {
  const parsed = typeof value === "string" ? Number(value.trim()) : value
  if (typeof parsed !== "number" || !Number.isFinite(parsed)) {
    errors.push({ field, message: "Enter a number." })
    return undefined
  }
  if (parsed < min || parsed > max) {
    errors.push({ field, message: `Must be between ${min} and ${max}.` })
    return undefined
  }
  // Two decimal places, matching DECIMAL(5,2).
  return Math.round(parsed * 100) / 100
}

function timeIn(value: unknown, field: string, errors: FieldError[]): string | undefined {
  if (typeof value !== "string" || !TIME_PATTERN.test(value.trim())) {
    errors.push({ field, message: "Use HH:MM, 24-hour." })
    return undefined
  }
  const match = TIME_PATTERN.exec(value.trim())!
  return `${match[1]}:${match[2]}:${match[3] ?? "00"}`
}

function optionalText(
  value: unknown,
  field: string,
  maxLength: number,
  errors: FieldError[]
): string | null | undefined {
  if (value === null) {
    return null
  }
  if (typeof value !== "string") {
    errors.push({ field, message: "Enter text." })
    return undefined
  }
  const trimmed = value.trim()
  if (trimmed.length > maxLength) {
    errors.push({ field, message: `Keep it under ${maxLength} characters.` })
    return undefined
  }
  return trimmed || null
}

/**
 * Multi-line text: CRLF normalised, each line trimmed, blank lines dropped,
 * and capped both in total length and in line count, since every line is a
 * printed line on the document letterhead.
 */
function optionalLines(
  value: unknown,
  field: string,
  maxLength: number,
  maxLines: number,
  errors: FieldError[]
): string | null | undefined {
  const text = optionalText(value, field, maxLength, errors)
  if (text === undefined || text === null) {
    return text
  }
  const lines = text
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
  if (lines.length > maxLines) {
    errors.push({ field, message: `Keep it to ${maxLines} lines or fewer.` })
    return undefined
  }
  return lines.length ? lines.join("\n") : null
}

export function validateSettingsPatch(input: SettingsPatchInput): SettingsValidation {
  const errors: FieldError[] = []
  const patch: SettingsPatch = {}

  if (input.reminderOffsets !== undefined) {
    const raw = input.reminderOffsets
    if (!Array.isArray(raw) || raw.length === 0) {
      errors.push({ field: "reminderOffsets", message: "Keep at least one reminder offset." })
    } else {
      const offsets = raw.map((entry) =>
        typeof entry === "string" ? Number(entry.trim()) : entry
      )
      if (offsets.some((entry) => typeof entry !== "number" || !Number.isInteger(entry) || entry < 0 || entry > 365)) {
        errors.push({ field: "reminderOffsets", message: "Offsets are whole days, 0 to 365." })
      } else {
        // Descending, de-duplicated: the cycle runs them furthest-first.
        patch.reminderOffsets = [...new Set(offsets as number[])].sort((a, b) => b - a)
      }
    }
  }

  if (input.readinessWindowDays !== undefined) {
    const value = integerIn(input.readinessWindowDays, "readinessWindowDays", 0, 365, errors)
    if (value !== undefined) patch.readinessWindowDays = value
  }

  if (input.defaultBillingPlan !== undefined) {
    if (input.defaultBillingPlan === "annually" || input.defaultBillingPlan === "bi_annually") {
      patch.defaultBillingPlan = input.defaultBillingPlan
    } else {
      errors.push({ field: "defaultBillingPlan", message: "Choose 1 year or 6 months." })
    }
  }

  if (input.taxRatePercent !== undefined) {
    const value = decimalIn(input.taxRatePercent, "taxRatePercent", 0, 100, errors)
    if (value !== undefined) patch.taxRatePercent = value
  }

  if (input.overrideVarianceThresholdPct !== undefined) {
    const value = decimalIn(input.overrideVarianceThresholdPct, "overrideVarianceThresholdPct", 0, 100, errors)
    if (value !== undefined) patch.overrideVarianceThresholdPct = value
  }

  if (input.graceWindowDays !== undefined) {
    const value = integerIn(input.graceWindowDays, "graceWindowDays", 0, 365, errors)
    if (value !== undefined) patch.graceWindowDays = value
  }

  if (input.dispatchEnabled !== undefined) {
    if (typeof input.dispatchEnabled === "boolean") {
      patch.dispatchEnabled = input.dispatchEnabled
    } else {
      errors.push({ field: "dispatchEnabled", message: "On or off." })
    }
  }

  if (input.sendWindowStart !== undefined) {
    const value = timeIn(input.sendWindowStart, "sendWindowStart", errors)
    if (value !== undefined) patch.sendWindowStart = value
  }
  if (input.sendWindowEnd !== undefined) {
    const value = timeIn(input.sendWindowEnd, "sendWindowEnd", errors)
    if (value !== undefined) patch.sendWindowEnd = value
  }
  if (
    patch.sendWindowStart !== undefined &&
    patch.sendWindowEnd !== undefined &&
    patch.sendWindowStart >= patch.sendWindowEnd
  ) {
    errors.push({ field: "sendWindowEnd", message: "The window must end after it starts." })
  }

  if (input.sessionExpiryMinutes !== undefined) {
    const value = integerIn(input.sessionExpiryMinutes, "sessionExpiryMinutes", 5, 10_080, errors)
    if (value !== undefined) patch.sessionExpiryMinutes = value
  }

  if (input.maxSessionRetries !== undefined) {
    const value = integerIn(input.maxSessionRetries, "maxSessionRetries", 0, 20, errors)
    if (value !== undefined) patch.maxSessionRetries = value
  }

  if (input.receiptPollCeilingSeconds !== undefined) {
    const value = integerIn(input.receiptPollCeilingSeconds, "receiptPollCeilingSeconds", 10, 600, errors)
    if (value !== undefined) patch.receiptPollCeilingSeconds = value
  }

  if (input.respondioWhatsappChannelId !== undefined) {
    const value = optionalText(input.respondioWhatsappChannelId, "respondioWhatsappChannelId", 64, errors)
    if (value !== undefined) patch.respondioWhatsappChannelId = value
  }

  if (input.bukkuDescriptionFormat !== undefined) {
    const value = optionalText(input.bukkuDescriptionFormat, "bukkuDescriptionFormat", 255, errors)
    if (value !== undefined) patch.bukkuDescriptionFormat = value
  }

  // The letterhead. Single-line fields are capped by column width; the
  // multi-line ones by how much fits beside the document title.
  if (input.sellerName !== undefined) {
    const value = optionalText(input.sellerName, "sellerName", 255, errors)
    if (value !== undefined) patch.sellerName = value
  }
  if (input.sellerRegistrationNo !== undefined) {
    const value = optionalText(input.sellerRegistrationNo, "sellerRegistrationNo", 120, errors)
    if (value !== undefined) patch.sellerRegistrationNo = value
  }
  if (input.sellerAddress !== undefined) {
    const value = optionalLines(input.sellerAddress, "sellerAddress", 1000, 6, errors)
    if (value !== undefined) patch.sellerAddress = value
  }
  if (input.sellerContact !== undefined) {
    const value = optionalLines(input.sellerContact, "sellerContact", 500, 4, errors)
    if (value !== undefined) patch.sellerContact = value
  }

  if (errors.length > 0) {
    return { ok: false, errors }
  }
  return { ok: true, patch }
}
