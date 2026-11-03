"use client"

import * as React from 'react'
import * as L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import type { GeoJsonObject } from 'geojson'
import type { PlotMapPreviewProps } from './PlotMapPreview'

const leafletRuntime = ((L as { default?: typeof L }).default ?? L) as typeof L

const TILE_URL =
  process.env.NEXT_PUBLIC_OM_DEALS_MAP_TILE_URL ?? 'https://tile.openstreetmap.org/{z}/{x}/{y}.png'
const TILE_ATTRIBUTION =
  process.env.NEXT_PUBLIC_OM_DEALS_MAP_TILE_ATTRIBUTION ??
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
const WORLD_CENTER: L.LatLngTuple = [20, 0]
const WORLD_ZOOM = 2

function readCssVariable(name: string, fallback: string): string {
  if (typeof document === 'undefined') return fallback
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  return value || fallback
}

function featureName(feature: unknown): string | null {
  if (!feature || typeof feature !== 'object' || Array.isArray(feature)) return null
  const properties = (feature as { properties?: unknown }).properties
  if (!properties || typeof properties !== 'object' || Array.isArray(properties)) return null
  const name = (properties as Record<string, unknown>).name
  return typeof name === 'string' && name.trim().length > 0 ? name.trim() : null
}

export default function PlotMapPreviewImpl({
  features,
  height = 280,
}: PlotMapPreviewProps): React.ReactElement {
  const containerRef = React.useRef<HTMLDivElement | null>(null)
  const mapRef = React.useRef<L.Map | null>(null)
  const layerRef = React.useRef<L.GeoJSON | null>(null)

  React.useEffect(() => {
    const node = containerRef.current
    if (!node || mapRef.current) return undefined
    const map = L.map(node, { zoomControl: false, worldCopyJump: true })
    L.control.zoom({ position: 'topleft' }).addTo(map)
    L.tileLayer(TILE_URL, { attribution: TILE_ATTRIBUTION, maxZoom: 19 }).addTo(map)
    map.setView(WORLD_CENTER, WORLD_ZOOM)
    mapRef.current = map
    const resizeObserver = new ResizeObserver(() => {
      map.invalidateSize()
    })
    resizeObserver.observe(node)
    return () => {
      resizeObserver.disconnect()
      map.stop()
      map.remove()
      mapRef.current = null
      layerRef.current = null
    }
  }, [])

  React.useEffect(() => {
    const map = mapRef.current
    if (!map) return
    if (layerRef.current) {
      layerRef.current.removeFrom(map)
      layerRef.current = null
    }
    if (!features.length) {
      map.setView(WORLD_CENTER, WORLD_ZOOM, { animate: false })
      return
    }

    const strokeColor = readCssVariable('--status-success-icon', 'var(--status-success-icon)')
    const fillColor = readCssVariable('--status-success-bg', 'var(--status-success-bg)')
    const layer = leafletRuntime.geoJSON(features as GeoJsonObject[], {
      style: () => ({
        color: strokeColor,
        fillColor,
        fillOpacity: 0.25,
        opacity: 0.95,
        weight: 2,
      }),
      pointToLayer: (_feature, latlng) => leafletRuntime.circleMarker(latlng, {
        radius: 7,
        color: strokeColor,
        fillColor: strokeColor,
        fillOpacity: 0.85,
        opacity: 1,
        weight: 2,
      }),
      onEachFeature: (feature, layerInstance) => {
        const name = featureName(feature)
        if (name) layerInstance.bindPopup(name)
      },
    }).addTo(map)
    layerRef.current = layer
    const bounds = layer.getBounds()
    if (bounds.isValid()) {
      map.fitBounds(bounds.pad(0.2), { animate: false })
    } else {
      map.setView(WORLD_CENTER, WORLD_ZOOM, { animate: false })
    }
  }, [features])

  return (
    <div className="relative overflow-hidden rounded-md border border-border bg-muted/30" style={{ height }}>
      <div ref={containerRef} className="absolute inset-0" />
    </div>
  )
}
