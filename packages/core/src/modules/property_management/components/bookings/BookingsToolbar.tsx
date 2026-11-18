"use client"

import * as React from 'react'
import { FilterBar } from '@open-mercato/ui/backend/FilterBar'
import { Tag } from '@open-mercato/ui/primitives/tag'
import { DatePicker } from '@open-mercato/ui/primitives/date-picker'
import { SegmentedControl, SegmentedControlItem } from '@open-mercato/ui/primitives/segmented-control'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@open-mercato/ui/primitives/select'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { useMondayDateLocale } from '../useMondayDateLocale'
import { fromIsoDay, toIsoDay } from './bookingModel'
import type { BookingBuildingOption } from './useBookingBuildingOptions'

export const ALL_BOOKINGS_FILTER = 'all'
const LOCATIONS_FAILED = 'locations-failed'

export type BookingsToolbarProps = {
  search: string
  onSearchChange: (value: string) => void
  chip: string
  onChipChange: (value: string) => void
  buildingId: string
  onBuildingChange: (value: string) => void
  buildings: BookingBuildingOption[]
  buildingsFailed: boolean
  onRetryBuildings: () => void
  date: string | null
  onDateChange: (value: string | null) => void
  bookingId: string | null
  onClearBookingId: () => void
  unitFilterLabel?: string | null
  onClearUnit?: () => void
}

export function BookingsToolbar(props: BookingsToolbarProps) {
  const t = useT()
  const dateLocale = useMondayDateLocale()
  const { buildings, buildingsFailed, bookingId } = props
  return (
    <FilterBar
      searchValue={props.search}
      onSearchChange={props.onSearchChange}
      searchPlaceholder={t('property_management.bookings.list.search', 'Search by unit or product')}
      trailingItems={(
        <div className="flex flex-wrap items-center gap-2">
          <SegmentedControl value={props.chip} onValueChange={props.onChipChange} aria-label={t('property_management.bookings.list.stateFilter', 'Filter by state')}>
            <SegmentedControlItem value="all">{t('property_management.bookings.list.chip.all', 'All')}</SegmentedControlItem>
            <SegmentedControlItem value="active">{t('property_management.bookings.list.chip.active', 'Active')}</SegmentedControlItem>
            <SegmentedControlItem value="past">{t('property_management.bookings.list.chip.past', 'Past and cancelled')}</SegmentedControlItem>
          </SegmentedControl>
          <Select
            value={props.buildingId}
            onValueChange={props.onBuildingChange}
            onOpenChange={(open) => { if (open && buildingsFailed) props.onRetryBuildings() }}
          >
            <SelectTrigger className="w-56" aria-label={t('property_management.bookings.list.buildingFilter', 'Filter by location')}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL_BOOKINGS_FILTER}>{t('property_management.bookings.list.allBuildings', 'All locations')}</SelectItem>
              {buildingsFailed ? (
                <SelectItem value={LOCATIONS_FAILED} disabled>
                  {t('property_management.bookings.list.buildingsLoadError', 'Could not load locations')}
                </SelectItem>
              ) : null}
              {buildings.map((building) => (
                <SelectItem key={building.id} value={building.id}>
                  {building.status === 'archived' ? `${building.name} (${t('property_management.floorPlan.buildingArchived', 'Archived')})` : building.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="w-48">
            <DatePicker
              locale={dateLocale}
              value={props.date ? fromIsoDay(props.date) : null}
              onChange={(value) => props.onDateChange(value ? toIsoDay(value) : null)}
              placeholder={t('property_management.bookings.list.dateFilter', 'Any date')}
              aria-label={t('property_management.bookings.list.dateFilterLabel', 'Filter by date')}
              showClearButton
            />
          </div>
          {bookingId ? (
            <Tag
              variant="info"
              onRemove={props.onClearBookingId}
              removeAriaLabel={t('property_management.bookings.list.idFilterClear', 'Show all bookings')}
              data-testid="pm-bookings-id-filter"
            >
              {t('property_management.bookings.list.idFilter', 'Only booking {id}', { id: bookingId.slice(0, 8) })}
            </Tag>
          ) : null}
          {props.unitFilterLabel ? (
            <Tag
              variant="info"
              onRemove={props.onClearUnit}
              removeAriaLabel={t('property_management.bookings.list.unitFilterClear', 'Show bookings of all units')}
              data-testid="pm-bookings-unit-filter"
            >
              {props.unitFilterLabel}
            </Tag>
          ) : null}
        </div>
      )}
    />
  )
}

export default BookingsToolbar
