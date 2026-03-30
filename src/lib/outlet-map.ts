import { parseDate } from "@/lib/dates"

export type OutletLifecycleStatus = "Active" | "Expiring Soon" | "Expired"
export type OutletStatusFilter = "all" | "active" | "expiring-soon" | "expired"

export function getOutletStatusLabel(
  validUntil: string | null | undefined
): OutletLifecycleStatus {
  if (!validUntil) {
    return "Active"
  }

  const parsed = parseDate(validUntil)
  if (!parsed) {
    return "Active"
  }

  const diffMs = parsed.getTime() - Date.now()
  if (diffMs < 0) {
    return "Expired"
  }

  const daysUntil = diffMs / (1000 * 60 * 60 * 24)
  if (daysUntil <= 30) {
    return "Expiring Soon"
  }

  return "Active"
}

export function getOutletStatusClasses(status: OutletLifecycleStatus) {
  switch (status) {
    case "Expired":
      return "bg-rose-500/10 text-rose-700 dark:text-rose-300"
    case "Expiring Soon":
      return "bg-amber-500/15 text-amber-700 dark:text-amber-300"
    default:
      return "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
  }
}

export function getOutletMarkerColor(status: OutletLifecycleStatus) {
  switch (status) {
    case "Expired":
      return "#dc2626"
    case "Expiring Soon":
      return "#eab308"
    default:
      return "#16a34a"
  }
}

export function getHighestRiskOutletStatus(
  statuses: OutletLifecycleStatus[]
): OutletLifecycleStatus {
  if (statuses.includes("Expired")) {
    return "Expired"
  }
  if (statuses.includes("Expiring Soon")) {
    return "Expiring Soon"
  }
  return "Active"
}

export function matchesOutletStatusFilter(
  status: OutletLifecycleStatus,
  filter: OutletStatusFilter
) {
  if (filter === "all") {
    return true
  }
  if (filter === "expired") {
    return status === "Expired"
  }
  if (filter === "expiring-soon") {
    return status === "Expiring Soon"
  }
  return status === "Active"
}

export function parseCoordinate(value: string | number | null | undefined) {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null
  }
  if (typeof value !== "string") {
    return null
  }

  const normalized = value.trim()
  if (!normalized) {
    return null
  }

  const parsed = Number(normalized)
  return Number.isFinite(parsed) ? parsed : null
}

export function hasValidCoordinates(
  latitude: string | number | null | undefined,
  longitude: string | number | null | undefined
) {
  const parsedLatitude = parseCoordinate(latitude)
  const parsedLongitude = parseCoordinate(longitude)

  return (
    parsedLatitude !== null &&
    parsedLongitude !== null &&
    parsedLatitude >= -90 &&
    parsedLatitude <= 90 &&
    parsedLongitude >= -180 &&
    parsedLongitude <= 180
  )
}

export function normalizeCoordinatePair(
  latitude: string | number | null | undefined,
  longitude: string | number | null | undefined
) {
  const parsedLatitude = parseCoordinate(latitude)
  const parsedLongitude = parseCoordinate(longitude)

  if (
    parsedLatitude === null ||
    parsedLongitude === null ||
    parsedLatitude < -90 ||
    parsedLatitude > 90 ||
    parsedLongitude < -180 ||
    parsedLongitude > 180
  ) {
    return null
  }

  return {
    latitude: parsedLatitude,
    longitude: parsedLongitude,
    key: `${parsedLatitude.toFixed(6)},${parsedLongitude.toFixed(6)}`,
  }
}

export function buildGoogleMapsUrl(
  mapsUrl: string | null | undefined,
  latitude: string | number | null | undefined,
  longitude: string | number | null | undefined
) {
  if (typeof mapsUrl === "string" && mapsUrl.trim()) {
    return mapsUrl.trim()
  }

  const parsedLatitude = parseCoordinate(latitude)
  const parsedLongitude = parseCoordinate(longitude)
  if (parsedLatitude === null || parsedLongitude === null) {
    return null
  }

  return `https://www.google.com/maps?q=${parsedLatitude},${parsedLongitude}`
}
