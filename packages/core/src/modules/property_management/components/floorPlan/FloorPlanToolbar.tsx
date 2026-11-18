"use client"

import * as React from 'react'
import Link from 'next/link'
import { Building2, Pencil, RefreshCw } from 'lucide-react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Button } from '@open-mercato/ui/primitives/button'
import { IconButton } from '@open-mercato/ui/primitives/icon-button'
import { DatePicker } from '@open-mercato/ui/primitives/date-picker'
import { SegmentedControl, SegmentedControlItem } from '@open-mercato/ui/primitives/segmented-control'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@open-mercato/ui/primitives/select'
import { fromIsoDay, toIsoDay } from '../bookings/bookingModel'
import { floorHref } from '../floor/types'
import { useMondayDateLocale } from '../useMondayDateLocale'
import { floorLabel, type BuildingOption } from './floorPlanModel'

const MAX_SEGMENTED_FLOORS = 8

export type FloorPlanToolbarProps = {
  buildings: BuildingOption[]
  building: BuildingOption
  floorId: string | null
  date: string
  today: string
  refreshing: boolean
  onBuildingChange: (buildingId: string) => void
  onFloorChange: (floorId: string) => void
  onDateChange: (date: string) => void
  onRefresh: () => void
}

export function FloorPlanToolbar({
  buildings,
  building,
  floorId,
  date,
  today,
  refreshing,
  onBuildingChange,
  onFloorChange,
  onDateChange,
  onRefresh,
}: FloorPlanToolbarProps) {
  const t = useT()
  const dateLocale = useMondayDateLocale()
  const archivedLabel = t('property_management.floorPlan.buildingArchived', 'Archived')
  return (
    <div className="flex flex-wrap items-center gap-2" data-testid="pm-floor-plan-toolbar">
      {buildings.length > 1 ? (
        <Select value={building.id} onValueChange={onBuildingChange}>
          <SelectTrigger className="w-56" aria-label={t('property_management.floorPlan.buildingSwitch', 'Location')}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {buildings.map((option) => (
              <SelectItem key={option.id} value={option.id}>
                {option.status === 'archived' ? `${option.name} (${archivedLabel})` : option.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : (
        <span className="inline-flex items-center gap-2 text-sm font-medium" data-testid="pm-floor-plan-building">
          <Building2 aria-hidden className="size-4 text-muted-foreground" />
          {building.name}
        </span>
      )}
      {building.floors.length > MAX_SEGMENTED_FLOORS ? (
        <Select value={floorId ?? undefined} onValueChange={onFloorChange}>
          <SelectTrigger className="w-56" aria-label={t('property_management.floorPlan.floorSwitch', 'Floor')}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {building.floors.map((floor) => (
              <SelectItem key={floor.id} value={floor.id}>{floorLabel(t, floor)}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : building.floors.length ? (
        <SegmentedControl
          value={floorId ?? undefined}
          onValueChange={onFloorChange}
          aria-label={t('property_management.floorPlan.floorSwitch', 'Floor')}
        >
          {building.floors.map((floor) => (
            <SegmentedControlItem key={floor.id} value={floor.id} title={floorLabel(t, floor)}>
              <span className="block max-w-40 truncate">{floorLabel(t, floor)}</span>
            </SegmentedControlItem>
          ))}
        </SegmentedControl>
      ) : null}
      <div className="w-44">
        <DatePicker
          locale={dateLocale}
          value={fromIsoDay(date)}
          onChange={(value) => onDateChange(value ? toIsoDay(value) : today)}
          footer="none"
          aria-label={t('property_management.floorPlan.date', 'Date')}
        />
      </div>
      {date !== today ? (
        <Button type="button" variant="ghost" onClick={() => onDateChange(today)}>
          {t('property_management.floorPlan.today', 'Today')}
        </Button>
      ) : null}
      <IconButton
        type="button"
        variant="outline"
        onClick={onRefresh}
        disabled={refreshing}
        aria-label={t('property_management.common.refresh', 'Refresh')}
      >
        <RefreshCw aria-hidden className="size-4" />
      </IconButton>
      {floorId ? (
        <Button asChild variant="outline">
          <Link href={floorHref(building.id, floorId)} data-testid="pm-floor-plan-edit-floor">
            <Pencil aria-hidden className="mr-2 size-4" />
            {t('property_management.floorPlan.editFloor', 'Edit floor')}
          </Link>
        </Button>
      ) : null}
    </div>
  )
}
