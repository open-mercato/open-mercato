"use client"

import * as React from 'react'
import Link from 'next/link'
import * as L from 'leaflet'
import 'leaflet.markercluster'
import 'leaflet/dist/leaflet.css'
import 'leaflet.markercluster/dist/MarkerCluster.css'
import 'leaflet.markercluster/dist/MarkerCluster.Default.css'
import { X } from 'lucide-react'
import { Button } from '@open-mercato/ui/primitives/button'
import { IconButton } from '@open-mercato/ui/primitives/icon-button'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { translateWithFallback } from '@open-mercato/shared/lib/i18n/translate'
import type { FilterOptionTone } from '@open-mercato/shared/lib/query/advanced-filter'
import { formatCurrency } from '../../../../../components/detail/utils'
import type {
  DealsMapCanvasDeal,
  DealsMapCanvasProps,
  DealsMapPreview,
} from './DealsMapCanvas'
import { createLogger } from '@open-mercato/shared/lib/logger'

const logger = createLogger('customers')

const leafletRuntime = ((L as { default?: typeof L }).default ?? L) as typeof L

const TILE_URL =
  process.env.NEXT_PUBLIC_OM_DEALS_MAP_TILE_URL ?? 'https://tile.openstreetmap.org/{z}/{x}/{y}.png'
const TILE_ATTRIBUTION =
  process.env.NEXT_PUBLIC_OM_DEALS_MAP_TILE_ATTRIBUTION ??
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
// True whenever the EFFECTIVE tile URL targets OSM's public CDN — whether from the bundled default
// (env unset) OR an env value pointed back at the same public host. OSM's tile usage policy
// prohibits production/commercial traffic against it. Match on the parsed hostname rather than a raw
// substring so a lookalike host (e.g. `tile.openstreetmap.org.example.com`) is not mistaken for OSM.
function targetsPublicOsmTileHost(tileUrl: string): boolean {
  try {
    const { hostname } = new URL(tileUrl)
    return hostname === 'openstreetmap.org' || hostname.endsWith('.openstreetmap.org')
  } catch {
    return false
  }
}

const USING_PUBLIC_OSM_TILES = targetsPublicOsmTileHost(TILE_URL)

let publicOsmTileWarningEmitted = false
// Warn once (per session) so deployments point NEXT_PUBLIC_OM_DEALS_MAP_TILE_URL at a self-hosted or
// commercial tile service instead of silently shipping against the shared public CDN.
function warnOnPublicOsmTilesOnce(): void {
  if (publicOsmTileWarningEmitted || !USING_PUBLIC_OSM_TILES) return
  publicOsmTileWarningEmitted = true
  logger.warn(
    'Deals map is using the public OpenStreetMap tile server. ' +
      "OSM's tile usage policy prohibits production/commercial traffic — point " +
      'NEXT_PUBLIC_OM_DEALS_MAP_TILE_URL at a self-hosted or commercial tile service before deploying.',
  )
}

const WORLD_CENTER: L.LatLngTuple = [20, 0]
const WORLD_ZOOM = 2
const SINGLE_PIN_ZOOM = 12
const FIT_PADDING: L.PointTuple = [32, 32]

// Saturated pin fill per stage tone — mirrors `Lane.tsx` ACCENT_TONE_CLASS so the same
// stage reads as the same color on the kanban color bar and on the map pin.
const PIN_TONE_CLASS: Record<FilterOptionTone, string> = {
  success: 'bg-status-success-icon',
  error: 'bg-status-error-icon',
  warning: 'bg-status-warning-icon',
  info: 'bg-status-info-icon',
  neutral: 'bg-status-neutral-icon',
  brand: 'bg-brand-violet',
  pink: 'bg-status-pink-icon',
}

// Stage badge surface for the preview card — mirrors `Lane.tsx` COUNT_BADGE_TONE_CLASS.
const STAGE_BADGE_TONE_CLASS: Record<FilterOptionTone, string> = {
  success: 'bg-status-success-bg text-status-success-text',
  error: 'bg-status-error-bg text-status-error-text',
  warning: 'bg-status-warning-bg text-status-warning-text',
  info: 'bg-status-info-bg text-status-info-text',
  neutral: 'bg-status-neutral-bg text-status-neutral-text',
  brand: 'bg-brand-violet/14 text-brand-violet',
  pink: 'bg-status-pink-bg text-status-pink-text',
}

function getPinToneClass(tone: FilterOptionTone | null): string {
  if (tone && tone in PIN_TONE_CLASS) return PIN_TONE_CLASS[tone]
  return 'bg-status-neutral-icon'
}

function getStageBadgeClass(tone: FilterOptionTone | null): string {
  if (tone && tone in STAGE_BADGE_TONE_CLASS) return STAGE_BADGE_TONE_CLASS[tone]
  return 'bg-muted text-muted-foreground'
}

// divIcon html is a raw string (no React) — only the server-issued deal id is interpolated,
// never user-entered text, and styling comes exclusively from DS token classes.
function buildMarkerIcon(dealId: string, tone: FilterOptionTone | null, selected: boolean): L.DivIcon {
  const sizePx = selected ? 20 : 14
  const dotClass = selected
    ? `block size-5 rounded-full border-2 border-card shadow-md ring-2 ring-ring ${getPinToneClass(tone)}`
    : `block size-3.5 rounded-full border-2 border-card shadow-md ${getPinToneClass(tone)}`
  return L.divIcon({
    className: `om-deal-map-marker${selected ? ' om-deal-map-marker--selected' : ''}`,
    html: `<span class="${dotClass}" data-deal-id="${dealId}"></span>`,
    iconSize: [sizePx, sizePx],
    iconAnchor: [sizePx / 2, sizePx / 2],
  })
}

function buildClusterIcon(count: number): L.DivIcon {
  return L.divIcon({
    className: 'om-deal-map-cluster',
    html: `<span class="flex size-9 items-center justify-center rounded-full border-2 border-card bg-brand-violet text-xs font-bold text-brand-violet-foreground shadow-md">${count}</span>`,
    iconSize: [36, 36],
    iconAnchor: [18, 18],
  })
}

const shortDateFormatter = new Intl.DateTimeFormat(undefined, {
  month: 'short',
  day: '2-digit',
})

function formatShortDate(value: string | null): string | null {
  if (!value) return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return shortDateFormatter.format(date)
}

type PreviewCardProps = {
  preview: DealsMapPreview
  onClose: () => void
}

function DealMapPreviewCard({ preview, onClose }: PreviewCardProps): React.ReactElement {
  const t = useT()
  const closeDate = formatShortDate(preview.expectedCloseAt)
  const metaParts: string[] = []
  if (typeof preview.valueAmount === 'number') {
    metaParts.push(formatCurrency(preview.valueAmount, preview.valueCurrency))
  }
  if (typeof preview.probability === 'number') {
    metaParts.push(
      translateWithFallback(t, 'customers.deals.map.preview.probabilityShort', '{value}%', {
        value: Math.min(Math.max(Math.round(preview.probability), 0), 100),
      }),
    )
  }
  if (closeDate) {
    metaParts.push(
      translateWithFallback(t, 'customers.deals.map.preview.closeShort', 'Close {date}', {
        date: closeDate,
      }),
    )
  }
  return (
    <div
      data-map-preview-card={preview.id}
      className="absolute right-3 top-3 z-10 flex w-80 max-w-full flex-col gap-2 rounded-xl border border-border bg-popover p-4 shadow-lg"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 flex-col">
          {preview.companyLabel ? (
            <span className="truncate text-sm font-medium leading-normal text-foreground">
              {preview.companyLabel}
            </span>
          ) : null}
          {preview.locationLine ? (
            <span className="truncate text-xs leading-normal text-muted-foreground">
              {preview.locationLine}
            </span>
          ) : null}
        </div>
        <IconButton
          variant="ghost"
          size="sm"
          type="button"
          onClick={onClose}
          aria-label={translateWithFallback(t, 'customers.deals.map.preview.close', 'Close preview')}
        >
          <X className="size-4" aria-hidden="true" />
        </IconButton>
      </div>
      <h3 className="text-base font-semibold leading-normal text-foreground">{preview.title}</h3>
      {metaParts.length > 0 ? (
        <p className="text-sm leading-normal text-muted-foreground">{metaParts.join(' · ')}</p>
      ) : null}
      {preview.stageLabel || preview.ownerName ? (
        <div className="flex flex-wrap items-center gap-1.5">
          {preview.stageLabel ? (
            <span
              className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-semibold leading-normal ${getStageBadgeClass(preview.stageTone)}`}
            >
              {preview.stageLabel}
            </span>
          ) : null}
          {preview.ownerName ? (
            <span className="inline-flex items-center rounded-md bg-muted px-2 py-0.5 text-xs font-medium leading-normal text-foreground">
              {preview.ownerName}
            </span>
          ) : null}
        </div>
      ) : null}
      <Button asChild className="mt-1 w-full">
        <Link href={`/backend/customers/deals/${preview.id}`}>
          {translateWithFallback(t, 'customers.deals.map.preview.openDeal', 'Open deal')}
        </Link>
      </Button>
    </div>
  )
}

export default function DealsMapCanvasImpl({
  deals,
  legendStages,
  preview,
  selectedDealId,
  onSelect,
  onCenterChange,
  className,
}: DealsMapCanvasProps): React.ReactElement {
  const t = useT()
  const containerRef = React.useRef<HTMLDivElement | null>(null)
  const mapRef = React.useRef<L.Map | null>(null)
  const clusterRef = React.useRef<L.MarkerClusterGroup | null>(null)
  const markersByIdRef = React.useRef(new Map<string, L.Marker>())
  const dealsByIdRef = React.useRef(new Map<string, DealsMapCanvasDeal>())
  const previousSelectedIdRef = React.useRef<string | null>(null)
  const lastFitSignatureRef = React.useRef<string | null>(null)
  const centerChangeTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null)

  const onSelectRef = React.useRef(onSelect)
  onSelectRef.current = onSelect
  const onCenterChangeRef = React.useRef(onCenterChange)
  onCenterChangeRef.current = onCenterChange

  React.useEffect(() => {
    const node = containerRef.current
    if (!node || mapRef.current) return undefined
    warnOnPublicOsmTilesOnce()
    const map = L.map(node, { zoomControl: false, worldCopyJump: true })
    // Zoom sits top-LEFT so it never overlaps the selection preview card (top-right overlay).
    L.control.zoom({ position: 'topleft' }).addTo(map)
    L.tileLayer(TILE_URL, { attribution: TILE_ATTRIBUTION, maxZoom: 19 }).addTo(map)
    map.setView(WORLD_CENTER, WORLD_ZOOM)
    const cluster = leafletRuntime.markerClusterGroup({
      showCoverageOnHover: false,
      iconCreateFunction: (markerCluster) => buildClusterIcon(markerCluster.getChildCount()),
    })
    map.addLayer(cluster)
    // `moveend` fires on every pan/zoom-end and each one re-renders the view + re-runs the panel's
    // proximity (haversine) sort, so debounce the state update. Read the center synchronously here
    // while the map pane is guaranteed positioned — deferring getCenter() into the timeout can hit
    // Leaflet's `_leaflet_pos` on a pane that has since been reset (fitBounds) or torn down.
    map.on('moveend', () => {
      const center = map.getCenter()
      if (centerChangeTimerRef.current) clearTimeout(centerChangeTimerRef.current)
      centerChangeTimerRef.current = setTimeout(() => {
        onCenterChangeRef.current({ latitude: center.lat, longitude: center.lng })
      }, 250)
    })
    mapRef.current = map
    clusterRef.current = cluster
    const resizeObserver = new ResizeObserver(() => {
      map.invalidateSize()
    })
    resizeObserver.observe(node)
    return () => {
      resizeObserver.disconnect()
      if (centerChangeTimerRef.current) {
        clearTimeout(centerChangeTimerRef.current)
        centerChangeTimerRef.current = null
      }
      // Cancel any in-flight pan/zoom/fly animation before teardown — otherwise its
      // CSS transitionend fires after the panes are gone and Leaflet reads `_leaflet_pos`
      // off an undefined map pane.
      map.stop()
      map.remove()
      mapRef.current = null
      clusterRef.current = null
      markersByIdRef.current.clear()
      dealsByIdRef.current.clear()
      previousSelectedIdRef.current = null
      lastFitSignatureRef.current = null
    }
  }, [])

  const dealsSignature = React.useMemo(() => deals.map((deal) => deal.id).join('|'), [deals])

  React.useEffect(() => {
    const map = mapRef.current
    const cluster = clusterRef.current
    if (!map || !cluster) return
    cluster.clearLayers()
    markersByIdRef.current.clear()
    dealsByIdRef.current.clear()
    const markers: L.Marker[] = []
    for (const deal of deals) {
      const marker = L.marker([deal.latitude, deal.longitude], {
        icon: buildMarkerIcon(deal.id, deal.tone, false),
        keyboard: false,
      })
      marker.on('click', () => onSelectRef.current(deal.id))
      markersByIdRef.current.set(deal.id, marker)
      dealsByIdRef.current.set(deal.id, deal)
      markers.push(marker)
    }
    cluster.addLayers(markers)
    if (lastFitSignatureRef.current !== dealsSignature) {
      lastFitSignatureRef.current = dealsSignature
      // Fit instantly (animate: false). The list pages in over several updates, so animated
      // re-fits would stack overlapping zoom transitions and race Leaflet's pane bookkeeping.
      map.stop()
      if (deals.length === 0) {
        map.setView(WORLD_CENTER, WORLD_ZOOM, { animate: false })
      } else if (deals.length === 1) {
        map.setView([deals[0].latitude, deals[0].longitude], SINGLE_PIN_ZOOM, { animate: false })
      } else {
        const bounds = L.latLngBounds(
          deals.map((deal) => [deal.latitude, deal.longitude] as L.LatLngTuple),
        )
        map.fitBounds(bounds, { padding: FIT_PADDING, animate: false })
      }
    }
  }, [deals, dealsSignature])

  React.useEffect(() => {
    const map = mapRef.current
    const cluster = clusterRef.current
    if (!map || !cluster) return
    const previousId = previousSelectedIdRef.current
    const selectionChanged = previousId !== selectedDealId
    if (previousId && previousId !== selectedDealId) {
      const previousMarker = markersByIdRef.current.get(previousId)
      const previousDeal = dealsByIdRef.current.get(previousId)
      if (previousMarker && previousDeal) {
        previousMarker.setIcon(buildMarkerIcon(previousDeal.id, previousDeal.tone, false))
      }
    }
    previousSelectedIdRef.current = selectedDealId
    if (!selectedDealId) return
    const marker = markersByIdRef.current.get(selectedDealId)
    const deal = dealsByIdRef.current.get(selectedDealId)
    if (!marker || !deal) return
    marker.setIcon(buildMarkerIcon(deal.id, deal.tone, true))
    // Only move the camera when the selection itself changed. This effect also depends on
    // `deals` so the selected marker's icon is re-applied after a marker rebuild — but a deal-set
    // change alone (e.g. a sibling query resolving) must not yank the viewport back to the pin.
    if (!selectionChanged) return
    map.stop()
    const visibleParent = cluster.getVisibleParent(marker)
    if (visibleParent && visibleParent !== marker) {
      cluster.zoomToShowLayer(marker, () => {})
    } else {
      map.flyTo(marker.getLatLng(), Math.max(map.getZoom(), SINGLE_PIN_ZOOM))
    }
  }, [selectedDealId, deals])

  // Escape clears the selected-deal preview. Bound at the document level (not the canvas region's
  // onKeyDown) so it fires regardless of whether focus is on the map, a panel card, or the preview
  // card. Registered only while a deal is selected, so it never swallows Escape elsewhere.
  React.useEffect(() => {
    if (!selectedDealId) return undefined
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      onSelectRef.current(null)
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [selectedDealId])

  return (
    <div
      role="region"
      aria-label={translateWithFallback(t, 'customers.deals.map.canvas.label', 'Deals map')}
      className={`relative ${className ?? ''}`.trim()}
    >
      <div ref={containerRef} data-map-canvas className="absolute inset-0 z-0" />
      {deals.length === 0 ? (
        <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center p-6">
          <div className="max-w-sm rounded-xl border border-border bg-card/95 p-4 text-center shadow-sm">
            <p className="text-sm font-medium leading-normal text-foreground">
              {translateWithFallback(t, 'customers.deals.map.panel.empty.title', 'No deals on the map yet')}
            </p>
            <p className="mt-1 text-xs leading-normal text-muted-foreground">
              {translateWithFallback(
                t,
                'customers.deals.map.panel.empty.description',
                'Add latitude and longitude to company or person addresses to plot their deals here.',
              )}
            </p>
          </div>
        </div>
      ) : null}
      {legendStages.length > 0 ? (
        <div className="absolute bottom-3 left-3 z-10 flex flex-col gap-1.5 rounded-lg border border-border bg-card/95 p-3">
          <span className="text-overline font-bold uppercase leading-normal text-muted-foreground">
            {translateWithFallback(t, 'customers.deals.map.legend.title', 'Stages')}
          </span>
          {legendStages.map((stage) => (
            <span key={stage.id} className="flex items-center gap-2 text-xs leading-normal text-foreground">
              <span
                className={`size-2.5 shrink-0 rounded-full ${getPinToneClass(stage.tone)}`}
                aria-hidden="true"
              />
              {stage.label}
            </span>
          ))}
        </div>
      ) : null}
      {preview ? <DealMapPreviewCard preview={preview} onClose={() => onSelectRef.current(null)} /> : null}
    </div>
  )
}
