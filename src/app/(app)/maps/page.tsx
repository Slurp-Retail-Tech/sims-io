"use client"

import * as React from "react"
import mapboxgl from "mapbox-gl"
import "mapbox-gl/dist/mapbox-gl.css"

import { ChevronRight, X } from "lucide-react"

import { useToast } from "@/components/toast-provider"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  buildGoogleMapsUrl,
  getHighestRiskOutletStatus,
  getOutletMarkerColor,
  getOutletStatusClasses,
  normalizeCoordinatePair,
  type OutletLifecycleStatus,
  type OutletStatusFilter,
} from "@/lib/outlet-map"
import { getSessionUser } from "@/lib/session"

type MapOutlet = {
  fid: string | null
  oid: string
  franchiseName: string
  outletName: string
  address: string | null
  latitude: string
  longitude: string
  mapsUrl: string | null
  validUntil: string | null
  status: OutletLifecycleStatus
  batcaveUrl: string | null
}

type OutletLocationGroup = {
  key: string
  latitude: number
  longitude: number
  status: OutletLifecycleStatus
  outlets: MapOutlet[]
}

const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN ?? ""
const DEFAULT_CENTER: [number, number] = [102.0, 4.5]
const DEFAULT_ZOOM = 6
const statusOptions: Array<{ value: OutletStatusFilter; label: string }> = [
  { value: "all", label: "All" },
  { value: "active", label: "Active" },
  { value: "expiring-soon", label: "Expiring Soon" },
  { value: "expired", label: "Expired" },
]

function groupOutletsByCoordinates(outlets: MapOutlet[]) {
  const groups = new Map<string, OutletLocationGroup>()

  for (const outlet of outlets) {
    const coordinates = normalizeCoordinatePair(outlet.latitude, outlet.longitude)
    if (!coordinates) {
      continue
    }

    const existing = groups.get(coordinates.key)
    if (existing) {
      existing.outlets.push(outlet)
      existing.status = getHighestRiskOutletStatus(
        existing.outlets.map((item) => item.status)
      )
      continue
    }

    groups.set(coordinates.key, {
      key: coordinates.key,
      latitude: coordinates.latitude,
      longitude: coordinates.longitude,
      status: outlet.status,
      outlets: [outlet],
    })
  }

  return Array.from(groups.values())
}

function getOutletKey(outlet: MapOutlet) {
  return `${outlet.fid ?? "fid"}-${outlet.oid}`
}

function getOutletCoordinateKey(outlet: MapOutlet) {
  return normalizeCoordinatePair(outlet.latitude, outlet.longitude)?.key ?? null
}

function sortOutlets(outlets: MapOutlet[]) {
  return [...outlets].sort((left, right) => {
    return (
      left.franchiseName.localeCompare(right.franchiseName) ||
      left.outletName.localeCompare(right.outletName) ||
      left.oid.localeCompare(right.oid)
    )
  })
}

export default function MapsPage() {
  const mapContainerRef = React.useRef<HTMLDivElement | null>(null)
  const mapRef = React.useRef<mapboxgl.Map | null>(null)
  const markersRef = React.useRef<Map<string, mapboxgl.Marker>>(new Map())
  const [loading, setLoading] = React.useState(true)
  const [searchInput, setSearchInput] = React.useState("")
  const [searchQuery, setSearchQuery] = React.useState("")
  const [statusFilter, setStatusFilter] = React.useState<OutletStatusFilter>("active")
  const [outlets, setOutlets] = React.useState<MapOutlet[]>([])
  const [selectedOutletKey, setSelectedOutletKey] = React.useState<string | null>(null)
  const [selectedGroupKey, setSelectedGroupKey] = React.useState<string | null>(null)
  const [mapReady, setMapReady] = React.useState(false)
  const { showToast } = useToast()

  const groupedOutlets = React.useMemo(() => groupOutletsByCoordinates(outlets), [outlets])
  const sortedOutlets = React.useMemo(() => sortOutlets(outlets), [outlets])
  const selectedOutlet = React.useMemo(
    () => sortedOutlets.find((outlet) => getOutletKey(outlet) === selectedOutletKey) ?? null,
    [selectedOutletKey, sortedOutlets]
  )

  const focusOutlet = React.useCallback((outlet: MapOutlet) => {
    const map = mapRef.current
    const coordinates = normalizeCoordinatePair(outlet.latitude, outlet.longitude)
    if (!coordinates) {
      return
    }

    setSelectedOutletKey(getOutletKey(outlet))
    setSelectedGroupKey(coordinates.key)

    if (map) {
      map.flyTo({
        center: [coordinates.longitude, coordinates.latitude],
        zoom: Math.max(map.getZoom(), 14),
        essential: true,
      })
    }
  }, [])

  React.useEffect(() => {
    const timeout = window.setTimeout(() => {
      setSearchQuery(searchInput.trim())
    }, 250)

    return () => {
      window.clearTimeout(timeout)
    }
  }, [searchInput])

  React.useEffect(() => {
    if (!mapContainerRef.current || mapRef.current || !MAPBOX_TOKEN) {
      return
    }

    const container = mapContainerRef.current
    const markerStore = markersRef.current
    mapboxgl.accessToken = MAPBOX_TOKEN
    const map = new mapboxgl.Map({
      container,
      style: "mapbox://styles/mapbox/streets-v12",
      center: DEFAULT_CENTER,
      zoom: DEFAULT_ZOOM,
    })

    map.addControl(new mapboxgl.NavigationControl(), "top-right")
    map.on("load", () => {
      setMapReady(true)
      map.resize()
    })

    mapRef.current = map

    const resizeObserver = new ResizeObserver(() => {
      map.resize()
    })
    resizeObserver.observe(container)

    return () => {
      resizeObserver.disconnect()
      markerStore.forEach((marker) => marker.remove())
      markerStore.clear()
      map.remove()
      mapRef.current = null
    }
  }, [])

  React.useEffect(() => {
    const user = getSessionUser()
    if (!user?.id) {
      setLoading(false)
      return
    }

    let cancelled = false

    const loadOutlets = async () => {
      setLoading(true)
      try {
        const params = new URLSearchParams()
        params.set("status", statusFilter)
        if (searchQuery) {
          params.set("q", searchQuery)
        }

        const response = await fetch(`/api/maps/outlets?${params.toString()}`)
        if (!response.ok) {
          throw new Error("Unable to load map outlets.")
        }

        const payload = (await response.json()) as { outlets?: MapOutlet[] }
        if (cancelled) {
          return
        }

        setOutlets(payload.outlets ?? [])
      } catch (error) {
        console.error(error)
        if (!cancelled) {
          setOutlets([])
          setSelectedOutletKey(null)
          setSelectedGroupKey(null)
          showToast("Unable to load map outlets.", "error")
        }
      } finally {
        if (!cancelled) {
          setLoading(false)
        }
      }
    }

    void loadOutlets()

    return () => {
      cancelled = true
    }
  }, [searchQuery, showToast, statusFilter])

  React.useEffect(() => {
    if (!selectedOutletKey) {
      setSelectedGroupKey(null)
      return
    }

    const nextSelectedOutlet = outlets.find(
      (outlet) => getOutletKey(outlet) === selectedOutletKey
    )
    if (!nextSelectedOutlet) {
      setSelectedOutletKey(null)
      setSelectedGroupKey(null)
      return
    }

    setSelectedGroupKey(getOutletCoordinateKey(nextSelectedOutlet))
  }, [outlets, selectedOutletKey])

  React.useEffect(() => {
    const map = mapRef.current
    if (!map || !mapReady) {
      return
    }

    map.resize()
    markersRef.current.forEach((marker) => marker.remove())
    markersRef.current.clear()

    for (const group of groupedOutlets) {
      const button = document.createElement("button")
      button.type = "button"
      button.setAttribute(
        "aria-label",
        `View outlets at ${group.latitude}, ${group.longitude}`
      )
      button.style.width = "20px"
      button.style.height = "20px"
      button.style.borderRadius = "9999px"
      button.style.border =
        group.key === selectedGroupKey ? "3px solid #111827" : "2px solid #ffffff"
      button.style.background = getOutletMarkerColor(group.status)
      button.style.boxShadow = "0 4px 12px rgba(15, 23, 42, 0.3)"
      button.style.cursor = "pointer"

      button.addEventListener("click", () => {
        const selectedFromGroup =
          group.outlets.find((outlet) => getOutletKey(outlet) === selectedOutletKey) ??
          group.outlets[0]
        if (selectedFromGroup) {
          focusOutlet(selectedFromGroup)
        }
      })

      const marker = new mapboxgl.Marker({ element: button })
        .setLngLat([group.longitude, group.latitude])
        .addTo(map)

      markersRef.current.set(group.key, marker)
    }

    if (groupedOutlets.length === 0) {
      map.easeTo({ center: DEFAULT_CENTER, zoom: DEFAULT_ZOOM })
      return
    }

    if (selectedOutlet) {
      return
    }
  }, [focusOutlet, groupedOutlets, mapReady, selectedGroupKey, selectedOutlet, selectedOutletKey])

  const selectedOutletGoogleMapsUrl = selectedOutlet
    ? buildGoogleMapsUrl(
        selectedOutlet.mapsUrl,
        selectedOutlet.latitude,
        selectedOutlet.longitude
      )
    : null

  return (
    <div className="animate-in fade-in slide-in-from-bottom-2 flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">Merchant Coverage Map</h1>
        <p className="text-muted-foreground text-sm">
          View merchant outlets with valid coordinates for active, expiring soon,
          and expired accounts across Malaysia.
        </p>
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,360px)_minmax(0,1fr)]">
        <Card className="flex h-[734px] min-h-[734px] min-w-0 overflow-hidden flex-col">
          <CardHeader className="min-w-0 space-y-3">
            <CardTitle className="text-base">Outlet list</CardTitle>
            <Input
              placeholder="Search by franchise or outlet name"
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
            />
            <Select
              value={statusFilter}
              onValueChange={(value) => setStatusFilter(value as OutletStatusFilter)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {statusOptions.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div className="text-muted-foreground text-xs">
              {loading
                ? "Loading outlets..."
                : `${sortedOutlets.length} outlets · ${groupedOutlets.length} pinned locations`}
            </div>
          </CardHeader>
          <CardContent className="min-h-0 min-w-0 flex-1 overflow-hidden">
            {loading ? (
              <div className="text-sm text-muted-foreground">Loading outlets...</div>
            ) : sortedOutlets.length === 0 ? (
              <div className="text-sm text-muted-foreground">
                No mapped outlets match the current filters.
              </div>
            ) : (
              <ScrollArea className="h-full min-w-0 rounded-md border [&>[data-slot=scroll-area-viewport]]:overflow-x-hidden [&_[data-radix-scroll-area-content]]:block [&_[data-radix-scroll-area-content]]:w-full">
                <div className="space-y-3 p-4 pr-7">
                  {sortedOutlets.map((outlet) => {
                    const isSelected = selectedOutletKey === getOutletKey(outlet)
                    return (
                      <button
                        key={getOutletKey(outlet)}
                        type="button"
                        onClick={() => focusOutlet(outlet)}
                        className={[
                          "hover:bg-muted/40 block w-full min-w-0 overflow-hidden rounded-2xl border px-4 py-4 text-left transition",
                          isSelected ? "border-primary/70 bg-muted/20" : "border-border/60",
                        ].join(" ")}
                      >
                        <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto_auto] items-start gap-x-3 gap-y-2">
                          <div className="min-w-0">
                            <div className="truncate text-sm font-semibold leading-tight">
                              {outlet.outletName}
                            </div>
                          </div>
                          <span
                            className={[
                              "shrink-0 rounded-full px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.14em]",
                              getOutletStatusClasses(outlet.status),
                            ].join(" ")}
                          >
                            {outlet.status}
                          </span>
                          <ChevronRight className="text-muted-foreground mt-0.5 size-4 shrink-0" />
                        </div>
                        <div className="text-muted-foreground mt-2 whitespace-normal break-words pr-2 text-xs leading-5">
                          {outlet.address ?? "Address pending"}
                        </div>
                        <div className="text-muted-foreground mt-2 truncate pr-2 text-[11px]">
                          {outlet.franchiseName}
                        </div>
                      </button>
                    )
                  })}
                </div>
              </ScrollArea>
            )}
          </CardContent>
        </Card>

        <Card className="flex h-[734px] min-h-[734px] min-w-0 flex-col">
          <CardHeader className="space-y-3">
            <CardTitle className="text-base">Merchant Coverage Map</CardTitle>
            <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
              {([
                { label: "Active", color: getOutletMarkerColor("Active") },
                { label: "Expiring Soon", color: getOutletMarkerColor("Expiring Soon") },
                { label: "Expired", color: getOutletMarkerColor("Expired") },
              ] as const).map((item) => (
                <div key={item.label} className="flex items-center gap-2">
                  <span
                    className="inline-flex h-3 w-3 rounded-full border border-white shadow"
                    style={{ backgroundColor: item.color }}
                  />
                  <span>{item.label}</span>
                </div>
              ))}
            </div>
          </CardHeader>
          <CardContent className="min-h-0 flex-1">
            {!MAPBOX_TOKEN ? (
              <div className="text-muted-foreground rounded-lg border border-dashed px-4 py-10 text-sm">
                Set `NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN` to load the map.
              </div>
            ) : null}
            <div className="relative h-full">
              <div
                ref={mapContainerRef}
                className="h-full min-h-0 rounded-xl border bg-muted/30"
              />

              {selectedOutlet ? (
                <div className="absolute inset-x-0 bottom-4 flex justify-center px-4">
                  <div className="bg-background/96 w-fit min-w-[22rem] rounded-xl border shadow-xl backdrop-blur">
                    <div className="relative px-4 py-3">
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        className="absolute top-2 right-2 z-10 h-8 w-8"
                        onClick={() => {
                          setSelectedOutletKey(null)
                          setSelectedGroupKey(null)
                        }}
                      >
                        <X className="size-4" />
                      </Button>
                      <div className="space-y-2 pr-8 text-sm">
                        <div className="flex flex-wrap items-center gap-2">
                          <div>
                            <div className="font-semibold">{selectedOutlet.outletName}</div>
                            <div className="text-muted-foreground text-xs">
                              {selectedOutlet.franchiseName}
                            </div>
                          </div>
                          <span
                            className={[
                              "rounded-full px-2.5 py-1 text-xs font-medium",
                              getOutletStatusClasses(selectedOutlet.status),
                            ].join(" ")}
                          >
                            {selectedOutlet.status}
                          </span>
                        </div>
                        <div className="grid gap-2 text-xs text-muted-foreground">
                          <div>
                            <span className="block text-[11px] uppercase tracking-wide">
                              Address
                            </span>
                            <span className="text-foreground">
                              <span className="block max-w-[26rem] whitespace-normal break-words leading-5">
                              {selectedOutlet.address ?? "Address pending"}
                              </span>
                            </span>
                          </div>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          {selectedOutlet.fid ? (
                            <Button asChild size="sm" variant="outline" className="whitespace-nowrap">
                              <a
                                href={`/merchants/${encodeURIComponent(selectedOutlet.fid)}`}
                                target="_blank"
                                rel="noreferrer"
                              >
                                View merchant
                              </a>
                            </Button>
                          ) : (
                            <Button size="sm" variant="outline" className="whitespace-nowrap" disabled>
                              View merchant
                            </Button>
                          )}
                          {selectedOutlet.batcaveUrl ? (
                            <Button asChild size="sm" variant="outline" className="whitespace-nowrap">
                              <a
                                href={selectedOutlet.batcaveUrl}
                                target="_blank"
                                rel="noreferrer"
                              >
                                Open Batcave
                              </a>
                            </Button>
                          ) : (
                            <Button size="sm" variant="outline" className="whitespace-nowrap" disabled>
                              Open Batcave
                            </Button>
                          )}
                          {selectedOutletGoogleMapsUrl ? (
                            <Button asChild size="sm" variant="outline" className="whitespace-nowrap">
                              <a
                                href={selectedOutletGoogleMapsUrl}
                                target="_blank"
                                rel="noreferrer"
                              >
                                Open Google Maps
                              </a>
                            </Button>
                          ) : null}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              ) : null}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
