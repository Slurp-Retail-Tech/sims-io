"use client"

import * as React from "react"
import { Loader2, MapPin, X } from "lucide-react"

import { useToast } from "@/components/toast-provider"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

export type GooglePlaceLocation = {
  googlePlaceId: string
  locationName: string
  locationAddress: string
  googleMapsUri: string | null
  locationLat: number | null
  locationLng: number | null
}

type PlacePrediction = {
  placeId: string
  text: string
  mainText: string
  secondaryText: string | null
}

export type GooglePlacePickerProps = {
  id: string
  /** Structured selection; null when nothing is selected (free text only). */
  value: GooglePlaceLocation | null
  /** The text in the input — "Name, Address" after a pick, or manual free text. */
  query: string
  onQueryChange: (query: string) => void
  onSelect: (location: GooglePlaceLocation) => void
  onClear: () => void
  /**
   * Keep the input editable as a plain text field when Places is disabled
   * (sales usage). Onboarding passes false to preserve its disabled-input
   * behavior.
   */
  allowFreeTextWhenDisabled?: boolean
  disabled?: boolean
  placeholder?: string
  helperText?: React.ReactNode
  /** Fires when the server reports Places enabled/disabled so callers can adjust validation. */
  onEnabledChange?: (enabled: boolean) => void
}

function createPlacesSessionToken() {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`
}

export function GooglePlacePicker({
  id,
  value,
  query,
  onQueryChange,
  onSelect,
  onClear,
  allowFreeTextWhenDisabled = false,
  disabled = false,
  placeholder = "Search Google Maps location",
  helperText,
  onEnabledChange,
}: GooglePlacePickerProps) {
  const { showToast } = useToast()
  const deferredQuery = React.useDeferredValue(query)
  const [sessionToken, setSessionToken] = React.useState(createPlacesSessionToken)
  const [predictions, setPredictions] = React.useState<PlacePrediction[]>([])
  const [loading, setLoading] = React.useState(false)
  const [detailsLoading, setDetailsLoading] = React.useState(false)
  const [placesEnabled, setPlacesEnabled] = React.useState(true)

  const onEnabledChangeRef = React.useRef(onEnabledChange)
  onEnabledChangeRef.current = onEnabledChange

  const updatePlacesEnabled = React.useCallback((enabled: boolean) => {
    setPlacesEnabled((current) => {
      if (current !== enabled) {
        onEnabledChangeRef.current?.(enabled)
      }
      return current === enabled ? current : enabled
    })
  }, [])

  // Prime enabled-detection with an empty-input autocomplete call on mount so
  // required-location validation knows whether Places is available.
  React.useEffect(() => {
    const controller = new AbortController()
    void (async () => {
      try {
        const response = await fetch("/api/google-places/autocomplete", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ input: "", sessionToken: "" }),
          signal: controller.signal,
        })
        const payload = (await response.json()) as { enabled?: boolean }
        if (response.ok && !controller.signal.aborted) {
          updatePlacesEnabled(payload.enabled !== false)
        }
      } catch {
        if (!controller.signal.aborted) {
          updatePlacesEnabled(false)
        }
      }
    })()
    return () => controller.abort()
  }, [updatePlacesEnabled])

  React.useEffect(() => {
    const input = deferredQuery.trim()
    if (!placesEnabled || input.length < 2 || value) {
      setPredictions([])
      return
    }

    const controller = new AbortController()
    void (async () => {
      setLoading(true)
      try {
        const response = await fetch("/api/google-places/autocomplete", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ input, sessionToken }),
          signal: controller.signal,
        })
        const payload = (await response.json()) as {
          enabled?: boolean
          predictions?: PlacePrediction[]
          error?: string
        }
        if (!response.ok) throw new Error(payload.error ?? "Unable to search Google Maps.")
        updatePlacesEnabled(payload.enabled !== false)
        setPredictions(payload.predictions ?? [])
      } catch (error) {
        if (!controller.signal.aborted) {
          showToast(
            error instanceof Error ? error.message : "Unable to search Google Maps.",
            "error"
          )
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false)
      }
    })()

    return () => controller.abort()
  }, [deferredQuery, value, placesEnabled, sessionToken, showToast, updatePlacesEnabled])

  const handlePredictionSelect = React.useCallback(
    async (prediction: PlacePrediction) => {
      setDetailsLoading(true)
      try {
        const response = await fetch("/api/google-places/details", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ placeId: prediction.placeId, sessionToken }),
        })
        const payload = (await response.json()) as {
          enabled?: boolean
          location?: GooglePlaceLocation | null
          error?: string
        }
        if (!response.ok) {
          throw new Error(payload.error ?? "Unable to load Google Maps location.")
        }
        if (!payload.location) {
          updatePlacesEnabled(payload.enabled !== false)
          throw new Error("Google Maps location details are unavailable.")
        }

        onSelect(payload.location)
        onQueryChange(
          `${payload.location.locationName}, ${payload.location.locationAddress}`
        )
        setPredictions([])
        setSessionToken(createPlacesSessionToken())
      } catch (error) {
        showToast(
          error instanceof Error
            ? error.message
            : "Unable to load Google Maps location.",
          "error"
        )
      } finally {
        setDetailsLoading(false)
      }
    },
    [onQueryChange, onSelect, sessionToken, showToast, updatePlacesEnabled]
  )

  const handleClear = React.useCallback(() => {
    onQueryChange("")
    onClear()
    setPredictions([])
    setSessionToken(createPlacesSessionToken())
  }, [onClear, onQueryChange])

  const inputDisabled = disabled || (!placesEnabled && !allowFreeTextWhenDisabled)

  return (
    <div className="space-y-2">
      <div className="relative">
        <MapPin className="text-muted-foreground absolute left-3 top-1/2 size-4 -translate-y-1/2" />
        <Input
          id={id}
          value={query}
          onChange={(event) => {
            onQueryChange(event.target.value)
            if (value) {
              onClear()
            }
          }}
          className="pl-9 pr-9"
          placeholder={placeholder}
          disabled={inputDisabled}
        />
        {query || value ? (
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="absolute right-1 top-1/2 size-7 -translate-y-1/2"
            onClick={handleClear}
            aria-label="Clear location"
            disabled={disabled}
          >
            <X className="size-4" />
          </Button>
        ) : null}
      </div>
      {!placesEnabled ? (
        <div className="text-muted-foreground text-xs">
          Google Places lookup is disabled.
          {allowFreeTextWhenDisabled ? " Enter the location manually." : null}
        </div>
      ) : helperText ? (
        <div className="text-muted-foreground text-xs">{helperText}</div>
      ) : null}
      {loading || detailsLoading ? (
        <div className="text-muted-foreground flex items-center gap-2 text-sm">
          <Loader2 className="size-4 animate-spin" />
          Loading locations...
        </div>
      ) : predictions.length > 0 ? (
        <div className="overflow-hidden rounded-md border">
          {predictions.map((prediction) => (
            <button
              key={prediction.placeId}
              type="button"
              className="hover:bg-muted flex w-full flex-col gap-0.5 px-3 py-2 text-left text-sm"
              onClick={() => void handlePredictionSelect(prediction)}
            >
              <span className="font-medium">{prediction.mainText}</span>
              <span className="text-muted-foreground text-xs">
                {prediction.secondaryText ?? prediction.text}
              </span>
            </button>
          ))}
        </div>
      ) : null}
      {value ? (
        <div className="rounded-md border p-3 text-sm">
          <div className="font-medium">{value.locationName}</div>
          <div className="text-muted-foreground mt-1">{value.locationAddress}</div>
        </div>
      ) : null}
    </div>
  )
}
