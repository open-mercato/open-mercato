"use client"

import * as React from 'react'
import { MapPin, MapPinOff } from 'lucide-react'
import { Button } from '@open-mercato/ui/primitives/button'
import { EmptyState } from '@open-mercato/ui/primitives/empty-state'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@open-mercato/ui/primitives/select'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { translateWithFallback } from '@open-mercato/shared/lib/i18n/translate'
import type { FilterOptionTone } from '@open-mercato/shared/lib/query/advanced-filter'
import { formatCurrency } from '../../../../../components/detail/utils'
import type { MapDeal, StageMeta } from './DealsMapView'
import type { MapCenter } from './DealsMapCanvas'

const STAGE_BADGE_TONE_CLASS: Record<FilterOptionTone, string> = {
  success: 'bg-status-success-bg text-status-success-text',
  error: 'bg-status-error-bg text-status-error-text',
  warning: 'bg-status-warning-bg text-status-warning-text',
  info: 'bg-status-info-bg text-status-info-text',
  neutral: 'bg-status-neutral-bg text-status-neutral-text',
  brand: 'bg-brand-violet/14 text-brand-violet',
  pink: 'bg-status-pink-bg text-status-pink-text',
}

function getStageBadgeClass(tone: FilterOptionTone | null): string {
  if (tone && tone in STAGE_BADGE_TONE_CLASS) return STAGE_BADGE_TONE_CLASS[tone]
  return 'bg-muted text-muted-foreground'
}

type PanelSort = 'proximity' | 'listOrder'

function haversineKm(
  a: { latitude: number; longitude: number },
  b: { latitude: number; longitude: number },
): number {
  const toRadians = (value: number) => (value * Math.PI) / 180
  const earthRadiusKm = 6371
  const dLat = toRadians(b.latitude - a.latitude)
  const dLng = toRadians(b.longitude - a.longitude)
  const sinLat = Math.sin(dLat / 2)
  const sinLng = Math.sin(dLng / 2)
  const h =
    sinLat * sinLat +
    Math.cos(toRadians(a.latitude)) * Math.cos(toRadians(b.latitude)) * sinLng * sinLng
  return 2 * earthRadiusKm * Math.asin(Math.min(1, Math.sqrt(h)))
}

type DealsLocationPanelProps = {
  deals: MapDeal[]
  total: number
  stageMetaById: Map<string, StageMeta>
  mapCenter: MapCenter | null
  selectedDealId: string | null
  onSelect: (dealId: string | null) => void
}

export function DealsLocationPanel({
  deals,
  total,
  stageMetaById,
  mapCenter,
  selectedDealId,
  onSelect,
}: DealsLocationPanelProps): React.ReactElement {
  const t = useT()
  const [panelSort, setPanelSort] = React.useState<PanelSort>('proximity')

  const locatedCount = React.useMemo(
    () => deals.reduce((count, deal) => (deal.location ? count + 1 : count), 0),
    [deals],
  )

  const visibleDeals = React.useMemo(() => {
    if (panelSort !== 'proximity' || !mapCenter) return deals
    const located = deals.filter((deal) => deal.location !== null)
    const locationless = deals.filter((deal) => deal.location === null)
    located.sort((a, b) => {
      const aDistance = haversineKm(mapCenter, a.location!)
      const bDistance = haversineKm(mapCenter, b.location!)
      return aDistance - bDistance
    })
    return [...located, ...locationless]
  }, [deals, panelSort, mapCenter])

  const noAddressLabel = translateWithFallback(
    t,
    'customers.deals.map.panel.noAddress',
    'No address coordinates',
  )

  return (
    <div className="flex w-full shrink-0 flex-col overflow-hidden rounded-xl border border-border bg-card lg:w-80">
      <div className="flex flex-col gap-1 border-b border-border px-4 py-3">
        <div className="flex items-baseline justify-between gap-2">
          <h2 className="text-sm font-semibold leading-normal text-foreground">
            {translateWithFallback(t, 'customers.deals.map.panel.title', 'Deals with location')}
          </h2>
          <span className="text-xs leading-normal text-muted-foreground">
            {translateWithFallback(t, 'customers.deals.map.panel.count', '{located} of {total}', {
              located: locatedCount,
              total,
            })}
          </span>
        </div>
        <p className="text-xs leading-normal text-muted-foreground">
          {translateWithFallback(
            t,
            'customers.deals.map.panel.hint',
            'Click a deal or a map pin to preview it.',
          )}
        </p>
        <div className="mt-2 flex items-center gap-2">
          <Select value={panelSort} onValueChange={(value) => setPanelSort(value as PanelSort)}>
            <SelectTrigger
              size="sm"
              className="w-auto min-w-36"
              aria-label={translateWithFallback(t, 'customers.deals.map.panel.sort.label', 'Sort deals panel')}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="proximity">
                {translateWithFallback(t, 'customers.deals.map.panel.sort.proximity', 'Closest first')}
              </SelectItem>
              <SelectItem value="listOrder">
                {translateWithFallback(t, 'customers.deals.map.panel.sort.listOrder', 'List order')}
              </SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="flex flex-1 flex-col gap-2 overflow-y-auto p-3">
        {deals.length === 0 ? (
          <EmptyState
            variant="subtle"
            size="sm"
            icon={<MapPinOff className="size-6" aria-hidden="true" />}
            title={translateWithFallback(
              t,
              'customers.deals.map.panel.empty.title',
              'No deals on the map yet',
            )}
            description={translateWithFallback(
              t,
              'customers.deals.map.panel.empty.description',
              'Add latitude and longitude to company or person addresses to plot their deals here.',
            )}
          />
        ) : null}
        {visibleDeals.map((deal) => {
          const stageMeta = deal.pipelineStageId ? stageMetaById.get(deal.pipelineStageId) ?? null : null
          const isSelected = deal.id === selectedDealId
          const locationLine = deal.location
            ? [deal.location.city, deal.location.region].filter(Boolean).join(', ') ||
              deal.location.country ||
              null
            : null
          return (
            <Button
              key={deal.id}
              type="button"
              variant="ghost"
              data-map-panel-card={deal.id}
              aria-label={deal.title}
              aria-pressed={isSelected}
              onClick={() => onSelect(deal.id)}
              className={`h-auto w-full flex-col items-stretch justify-start gap-1 whitespace-normal rounded-lg border border-border p-3 text-left shadow-none ${
                isSelected ? 'bg-muted' : 'bg-card'
              } ${deal.location ? '' : 'opacity-60'}`}
            >
              <div className="flex items-baseline justify-between gap-2">
                <span className="truncate text-sm font-medium leading-normal text-foreground">
                  {deal.companyLabel ?? '—'}
                </span>
                {typeof deal.valueAmount === 'number' ? (
                  <span className="shrink-0 text-sm font-semibold leading-normal text-foreground">
                    {formatCurrency(deal.valueAmount, deal.valueCurrency)}
                  </span>
                ) : null}
              </div>
              <span className="truncate text-sm leading-normal text-muted-foreground">{deal.title}</span>
              <div className="flex items-center justify-between gap-2">
                <span className="flex min-w-0 items-center gap-1.5 text-xs leading-normal text-muted-foreground">
                  {deal.location ? (
                    <>
                      <MapPin className="size-3.5 shrink-0" aria-hidden="true" />
                      <span className="truncate">{locationLine ?? noAddressLabel}</span>
                    </>
                  ) : (
                    <>
                      <MapPinOff className="size-3.5 shrink-0" aria-hidden="true" />
                      <span className="truncate">{noAddressLabel}</span>
                    </>
                  )}
                </span>
                {stageMeta ? (
                  <span
                    className={`inline-flex shrink-0 items-center rounded-md px-2 py-0.5 text-xs font-semibold leading-normal ${getStageBadgeClass(stageMeta.tone)}`}
                  >
                    {stageMeta.label}
                  </span>
                ) : null}
              </div>
            </Button>
          )
        })}
      </div>
    </div>
  )
}

export default DealsLocationPanel
