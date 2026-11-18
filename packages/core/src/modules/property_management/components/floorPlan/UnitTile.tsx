"use client"

import * as React from 'react'
import { CalendarClock, Clock, DoorOpen, Lock, Send } from 'lucide-react'
import { useLocale, useT } from '@open-mercato/shared/lib/i18n/context'
import { cn } from '@open-mercato/shared/lib/utils'
import { Badge } from '@open-mercato/ui/primitives/badge'
import { Button } from '@open-mercato/ui/primitives/button'
import { StatusBadge } from '@open-mercato/ui/primitives/status-badge'
import { rectStyle } from '../floor/scale'
import { formatDate } from '../leases/leaseModel'
import {
  UNIT_STATUS_TILE_CLASSES,
  UNIT_STATUS_VARIANTS,
  unitStatusLabel,
  unitStatusOf,
  unitSubtitle,
  type FloorPlanUnit,
} from './floorPlanModel'

export type UnitTileProps = {
  unit: FloorPlanUnit
  sizeX: number
  sizeY: number
  selected: boolean
  tabStop?: boolean
  onSelect: (unitId: string) => void
}

export function UnitTile({ unit, sizeX, sizeY, selected, tabStop = true, onSelect }: UnitTileProps) {
  const t = useT()
  const locale = useLocale()
  const status = unitStatusOf(unit)
  const variant = UNIT_STATUS_VARIANTS[status]
  const statusLabel = unitStatusLabel(t, status)
  const subtitle = unitSubtitle(t, unit, locale)
  const reservedUntil = unit.reservation ? formatDate(unit.reservation.until, locale) : null
  const reservedLabel = reservedUntil ? t('property_management.floorPlan.tile.reservedUntil', 'Reserved until {date}', { date: reservedUntil }) : null
  const endsOn = unit.leaseEnding && unit.lease ? formatDate(unit.lease.endsOn, locale) : null
  const Icon = unit.use === 'bookable' ? CalendarClock : DoorOpen
  const ariaParts = [unit.name, statusLabel, subtitle]
  if (endsOn) ariaParts.push(t('property_management.floorPlan.tile.endsOn', 'Ends {date}', { date: endsOn }))
  if (reservedLabel) ariaParts.push(reservedLabel)
  if (unit.proposed) ariaParts.push(t('property_management.floorPlan.legend.proposed', 'Proposed'))
  return (
    <Button
      type="button"
      variant="ghost"
      data-testid={`pm-floor-plan-unit-${unit.id}`}
      data-unit-id={unit.id}
      data-status={status}
      aria-pressed={selected}
      aria-haspopup="dialog"
      aria-label={ariaParts.filter(Boolean).join(', ')}
      tabIndex={tabStop ? 0 : -1}
      onClick={() => onSelect(unit.id)}
      className={cn(
        'absolute block h-auto overflow-hidden whitespace-normal rounded-sm p-0 text-left font-normal',
        selected ? 'z-10 ring-2 ring-primary' : null,
      )}
      style={rectStyle(unit, sizeX, sizeY)}
    >
      <span
        className={cn(
          'flex size-full flex-col items-start gap-1 overflow-hidden rounded-sm border p-1.5',
          UNIT_STATUS_TILE_CLASSES[variant],
          unit.leaseEnding ? 'border-2 border-dashed border-status-warning-icon' : null,
        )}
      >
        <span className="flex w-full items-center justify-between gap-1">
          <span className="truncate text-xs font-semibold text-foreground">{unit.name}</span>
          <Icon aria-hidden className="size-3 shrink-0 text-muted-foreground" />
        </span>
        {subtitle ? <span className="w-full truncate text-xs text-muted-foreground">{subtitle}</span> : null}
        <span className="flex flex-wrap gap-1">
          <StatusBadge variant={variant} dot>{statusLabel}</StatusBadge>
          {endsOn ? (
            <Badge variant="warning">
              <Clock aria-hidden className="size-3" />
              {t('property_management.floorPlan.tile.endsOn', 'Ends {date}', { date: endsOn })}
            </Badge>
          ) : null}
          {reservedLabel ? (
            <Badge variant="warning" data-testid={`pm-floor-plan-reserved-${unit.id}`}>
              <Lock aria-hidden className="size-3" />
              {reservedLabel}
            </Badge>
          ) : null}
          {unit.proposed ? (
            <Badge variant="info">
              <Send aria-hidden className="size-3" />
              {t('property_management.floorPlan.legend.proposed', 'Proposed')}
            </Badge>
          ) : null}
        </span>
      </span>
    </Button>
  )
}
