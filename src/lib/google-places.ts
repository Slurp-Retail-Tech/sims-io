export type GooglePlacesConfig =
  | { enabled: false }
  | { enabled: true; apiKey: string; regionCodes: string[] }

export type GooglePlacePrediction = {
  placeId: string
  text: string
  mainText: string
  secondaryText: string | null
}

export type OnboardingPlaceLocation = {
  googlePlaceId: string
  locationName: string
  locationAddress: string
  googleMapsUri: string | null
  locationLat: number | null
  locationLng: number | null
}

type GooglePlacesAutocompleteResponse = {
  suggestions?: Array<{
    placePrediction?: {
      placeId?: string
      text?: { text?: string }
      structuredFormat?: {
        mainText?: { text?: string }
        secondaryText?: { text?: string }
      }
    }
  }>
}

type GooglePlaceDetailsResponse = {
  id?: string
  displayName?: { text?: string }
  formattedAddress?: string
  googleMapsUri?: string
  location?: {
    latitude?: number
    longitude?: number
  }
}

const GOOGLE_PLACES_AUTOCOMPLETE_URL =
  "https://places.googleapis.com/v1/places:autocomplete"
const GOOGLE_PLACES_FIELD_MASK =
  "suggestions.placePrediction.placeId,suggestions.placePrediction.text.text,suggestions.placePrediction.structuredFormat.mainText.text,suggestions.placePrediction.structuredFormat.secondaryText.text"
const GOOGLE_PLACE_DETAILS_FIELD_MASK =
  "id,displayName,formattedAddress,location,googleMapsUri"

function cleanString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null
}

function parseRegionCodes(value: string | undefined) {
  const parsed = (value ?? "MY")
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean)
  return parsed.length > 0 ? parsed : ["my"]
}

export function getGooglePlacesConfig(): GooglePlacesConfig {
  const enabled = process.env.GOOGLE_PLACES_ENABLED?.trim().toLowerCase()
  const apiKey = process.env.GOOGLE_PLACES_API_KEY?.trim()
  if (enabled !== "true" || !apiKey) {
    return { enabled: false }
  }
  return {
    enabled: true,
    apiKey,
    regionCodes: parseRegionCodes(process.env.GOOGLE_PLACES_REGION_CODES),
  }
}

async function parseGooglePlacesResponse(response: Response) {
  try {
    return (await response.json()) as unknown
  } catch {
    return null
  }
}

function getGooglePlacesErrorMessage(payload: unknown) {
  if (!payload || typeof payload !== "object") {
    return null
  }
  const record = payload as Record<string, unknown>
  const error = record.error
  if (error && typeof error === "object") {
    const message = (error as Record<string, unknown>).message
    if (typeof message === "string" && message.trim()) {
      return message.trim()
    }
  }
  const message = record.message
  return typeof message === "string" && message.trim() ? message.trim() : null
}

function mapAutocompleteResponse(
  payload: GooglePlacesAutocompleteResponse
): GooglePlacePrediction[] {
  return (payload.suggestions ?? [])
    .map((suggestion) => {
      const prediction = suggestion.placePrediction
      const placeId = cleanString(prediction?.placeId)
      const text = cleanString(prediction?.text?.text)
      const mainText = cleanString(prediction?.structuredFormat?.mainText?.text)
      if (!placeId || !text || !mainText) {
        return null
      }
      return {
        placeId,
        text,
        mainText,
        secondaryText:
          cleanString(prediction?.structuredFormat?.secondaryText?.text) ?? null,
      }
    })
    .filter((prediction): prediction is GooglePlacePrediction =>
      Boolean(prediction)
    )
}

export async function searchGooglePlacesAutocomplete(input: {
  input: string
  sessionToken: string
}) {
  const config = getGooglePlacesConfig()
  if (!config.enabled) {
    return { enabled: false as const, predictions: [] }
  }

  const searchInput = cleanString(input.input)
  const sessionToken = cleanString(input.sessionToken)
  if (!searchInput || !sessionToken) {
    return { enabled: true as const, predictions: [] }
  }

  const response = await fetch(GOOGLE_PLACES_AUTOCOMPLETE_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": config.apiKey,
      "X-Goog-FieldMask": GOOGLE_PLACES_FIELD_MASK,
    },
    body: JSON.stringify({
      input: searchInput,
      sessionToken,
      includedRegionCodes: config.regionCodes,
    }),
    cache: "no-store",
  })

  const payload = await parseGooglePlacesResponse(response)
  if (!response.ok) {
    throw new Error(
      getGooglePlacesErrorMessage(payload) ||
        `Google Places autocomplete failed (${response.status})`
    )
  }

  return {
    enabled: true as const,
    predictions: mapAutocompleteResponse(
      (payload ?? {}) as GooglePlacesAutocompleteResponse
    ),
  }
}

export function mapGooglePlaceDetails(
  payload: GooglePlaceDetailsResponse
): OnboardingPlaceLocation {
  const googlePlaceId = cleanString(payload.id)
  const locationName = cleanString(payload.displayName?.text)
  const locationAddress = cleanString(payload.formattedAddress)
  if (!googlePlaceId || !locationName || !locationAddress) {
    throw new Error("Google Places details response was missing location data")
  }

  const latitude = payload.location?.latitude
  const longitude = payload.location?.longitude

  return {
    googlePlaceId,
    locationName,
    locationAddress,
    googleMapsUri: cleanString(payload.googleMapsUri),
    locationLat: typeof latitude === "number" ? latitude : null,
    locationLng: typeof longitude === "number" ? longitude : null,
  }
}

export async function getGooglePlaceDetails(input: {
  placeId: string
  sessionToken: string
}) {
  const config = getGooglePlacesConfig()
  if (!config.enabled) {
    return { enabled: false as const, location: null }
  }

  const placeId = cleanString(input.placeId)
  const sessionToken = cleanString(input.sessionToken)
  if (!placeId || !sessionToken) {
    throw new Error("Place id and session token are required")
  }

  const url = new URL(
    `https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}`
  )
  url.searchParams.set("sessionToken", sessionToken)

  const response = await fetch(url.toString(), {
    method: "GET",
    headers: {
      "X-Goog-Api-Key": config.apiKey,
      "X-Goog-FieldMask": GOOGLE_PLACE_DETAILS_FIELD_MASK,
    },
    cache: "no-store",
  })

  const payload = await parseGooglePlacesResponse(response)
  if (!response.ok) {
    throw new Error(
      getGooglePlacesErrorMessage(payload) ||
        `Google Places details failed (${response.status})`
    )
  }

  return {
    enabled: true as const,
    location: mapGooglePlaceDetails(
      (payload ?? {}) as GooglePlaceDetailsResponse
    ),
  }
}
