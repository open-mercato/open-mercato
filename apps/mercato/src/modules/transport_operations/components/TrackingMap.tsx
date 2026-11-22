"use client"

import * as React from 'react'
import 'leaflet/dist/leaflet.css'
import type { Map as LeafletMap, LayerGroup } from 'leaflet'

export type TrackingVehicleMarker = {
  vehicleId: string
  plateNumber: string
  driverName?: string | null
  activeTrip?: { tripNumber: string; origin: string; destination: string; executionStatus: string } | null
  position: { latitude: number; longitude: number; speedKph?: number | null; recordedAt?: string | null }
}

const DEFAULT_CENTER: [number, number] = [24.7136, 46.6753]

export default function TrackingMap({ vehicles }: { vehicles: TrackingVehicleMarker[] }) {
  const containerRef = React.useRef<HTMLDivElement | null>(null)
  const mapRef = React.useRef<LeafletMap | null>(null)
  const layerRef = React.useRef<LayerGroup | null>(null)

  React.useEffect(() => {
    let cancelled = false
    async function initialize() {
      if (!containerRef.current || mapRef.current) return
      const L = await import('leaflet')
      if (cancelled || !containerRef.current) return
      const map = L.map(containerRef.current, { zoomControl: true }).setView(DEFAULT_CENTER, 6)
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; OpenStreetMap contributors',
        maxZoom: 18,
      }).addTo(map)
      mapRef.current = map
      layerRef.current = L.layerGroup().addTo(map)
      updateMarkers(L, map, layerRef.current, vehicles)
    }
    void initialize()
    return () => {
      cancelled = true
      mapRef.current?.remove()
      mapRef.current = null
      layerRef.current = null
    }
    // The map is created once; marker refresh is handled by the effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  React.useEffect(() => {
    let cancelled = false
    async function refresh() {
      if (!mapRef.current || !layerRef.current) return
      const L = await import('leaflet')
      if (cancelled || !mapRef.current || !layerRef.current) return
      updateMarkers(L, mapRef.current, layerRef.current, vehicles)
    }
    void refresh()
    return () => { cancelled = true }
  }, [vehicles])

  return <div ref={containerRef} className="h-[28rem] w-full rounded-lg border border-border bg-muted/30" />
}

function updateMarkers(
  L: typeof import('leaflet'),
  map: LeafletMap,
  layer: LayerGroup,
  vehicles: TrackingVehicleMarker[],
) {
  layer.clearLayers()
  const points: Array<[number, number]> = []
  for (const vehicle of vehicles) {
    const point: [number, number] = [vehicle.position.latitude, vehicle.position.longitude]
    points.push(point)
    const popup = document.createElement('div')
    popup.className = 'flex flex-col gap-1 text-sm'
    const title = document.createElement('strong')
    title.textContent = vehicle.plateNumber
    popup.appendChild(title)
    if (vehicle.driverName) {
      const driver = document.createElement('span')
      driver.textContent = vehicle.driverName
      popup.appendChild(driver)
    }
    if (vehicle.activeTrip) {
      const trip = document.createElement('span')
      trip.textContent = `${vehicle.activeTrip.tripNumber}: ${vehicle.activeTrip.origin} → ${vehicle.activeTrip.destination}`
      popup.appendChild(trip)
    }
    if (vehicle.position.speedKph !== undefined && vehicle.position.speedKph !== null) {
      const speed = document.createElement('span')
      speed.textContent = `${vehicle.position.speedKph} km/h`
      popup.appendChild(speed)
    }
    L.circleMarker(point, { radius: 8, weight: 2 }).addTo(layer).bindPopup(popup)
  }
  if (points.length === 1) {
    map.setView(points[0], 12)
  } else if (points.length > 1) {
    map.fitBounds(L.latLngBounds(points), { padding: [32, 32], maxZoom: 13 })
  }
}
