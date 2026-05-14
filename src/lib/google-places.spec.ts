import assert from "node:assert/strict"
import test from "node:test"

import {
  getGooglePlacesConfig,
  mapGooglePlaceDetails,
  searchGooglePlacesAutocomplete,
} from "./google-places.ts"

test("treats Google Places as disabled unless enabled with an API key", () => {
  const originalEnabled = process.env.GOOGLE_PLACES_ENABLED
  const originalApiKey = process.env.GOOGLE_PLACES_API_KEY
  const originalRegions = process.env.GOOGLE_PLACES_REGION_CODES

  try {
    process.env.GOOGLE_PLACES_ENABLED = "true"
    delete process.env.GOOGLE_PLACES_API_KEY
    process.env.GOOGLE_PLACES_REGION_CODES = "MY,SG"

    assert.deepEqual(getGooglePlacesConfig(), { enabled: false })

    process.env.GOOGLE_PLACES_API_KEY = "places-key"
    assert.deepEqual(getGooglePlacesConfig(), {
      enabled: true,
      apiKey: "places-key",
      regionCodes: ["my", "sg"],
    })
  } finally {
    if (originalEnabled === undefined) delete process.env.GOOGLE_PLACES_ENABLED
    else process.env.GOOGLE_PLACES_ENABLED = originalEnabled

    if (originalApiKey === undefined) delete process.env.GOOGLE_PLACES_API_KEY
    else process.env.GOOGLE_PLACES_API_KEY = originalApiKey

    if (originalRegions === undefined) delete process.env.GOOGLE_PLACES_REGION_CODES
    else process.env.GOOGLE_PLACES_REGION_CODES = originalRegions
  }
})

test("autocomplete sends region codes and session token with minimal field mask", async () => {
  const originalEnabled = process.env.GOOGLE_PLACES_ENABLED
  const originalApiKey = process.env.GOOGLE_PLACES_API_KEY
  const originalRegions = process.env.GOOGLE_PLACES_REGION_CODES
  const originalFetch = globalThis.fetch
  const calls: Array<{ url: string; init: RequestInit }> = []

  try {
    process.env.GOOGLE_PLACES_ENABLED = "true"
    process.env.GOOGLE_PLACES_API_KEY = "places-key"
    process.env.GOOGLE_PLACES_REGION_CODES = "MY"
    globalThis.fetch = async (input, init) => {
      calls.push({ url: String(input), init: init ?? {} })
      return new Response(
        JSON.stringify({
          suggestions: [
            {
              placePrediction: {
                placeId: "ChIJ123",
                text: { text: "Suria KLCC, Kuala Lumpur" },
                structuredFormat: {
                  mainText: { text: "Suria KLCC" },
                  secondaryText: { text: "Kuala Lumpur" },
                },
              },
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    }

    const result = await searchGooglePlacesAutocomplete({
      input: "suria",
      sessionToken: "session-123",
    })

    assert.deepEqual(result, {
      enabled: true,
      predictions: [
        {
          placeId: "ChIJ123",
          text: "Suria KLCC, Kuala Lumpur",
          mainText: "Suria KLCC",
          secondaryText: "Kuala Lumpur",
        },
      ],
    })
    assert.equal(calls.length, 1)
    assert.equal(calls[0].url, "https://places.googleapis.com/v1/places:autocomplete")
    assert.equal(
      (calls[0].init.headers as Record<string, string>)["X-Goog-FieldMask"],
      "suggestions.placePrediction.placeId,suggestions.placePrediction.text.text,suggestions.placePrediction.structuredFormat.mainText.text,suggestions.placePrediction.structuredFormat.secondaryText.text"
    )
    assert.deepEqual(JSON.parse(String(calls[0].init.body)), {
      input: "suria",
      sessionToken: "session-123",
      includedRegionCodes: ["my"],
    })
  } finally {
    globalThis.fetch = originalFetch

    if (originalEnabled === undefined) delete process.env.GOOGLE_PLACES_ENABLED
    else process.env.GOOGLE_PLACES_ENABLED = originalEnabled

    if (originalApiKey === undefined) delete process.env.GOOGLE_PLACES_API_KEY
    else process.env.GOOGLE_PLACES_API_KEY = originalApiKey

    if (originalRegions === undefined) delete process.env.GOOGLE_PLACES_REGION_CODES
    else process.env.GOOGLE_PLACES_REGION_CODES = originalRegions
  }
})

test("maps Place Details response into persisted onboarding location fields", () => {
  assert.deepEqual(
    mapGooglePlaceDetails({
      id: "ChIJ123",
      displayName: { text: "Suria KLCC" },
      formattedAddress: "Kuala Lumpur City Centre, 50088 Kuala Lumpur",
      googleMapsUri: "https://maps.google.com/?cid=123",
      location: { latitude: 3.1579, longitude: 101.7123 },
    }),
    {
      googlePlaceId: "ChIJ123",
      locationName: "Suria KLCC",
      locationAddress: "Kuala Lumpur City Centre, 50088 Kuala Lumpur",
      googleMapsUri: "https://maps.google.com/?cid=123",
      locationLat: 3.1579,
      locationLng: 101.7123,
    }
  )
})
