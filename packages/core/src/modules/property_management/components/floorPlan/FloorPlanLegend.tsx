"use client"

import * as React from 'react'
import { Clock, Send } from 'lucide-react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { usePlural } from '../plural'
import { cn } from '@open-mercato/shared/lib/utils'
import { Badge } from '@open-mercato/ui/primitives/badge'
import { StatusBadge } from '@open-mercato/ui/primitives/status-badge'
import { HATCH_STYLE, UNIT_STATUS_VARIANTS, unitStatusLabel, type FloorUnitStatus } from './floorPlanModel'

function LegendGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      {children}
    </div>
  )
}

function StatusChip({ status }: { status: FloorUnitStatus }) {
  const t = useT()
  return (
    <StatusBadge variant={UNIT_STATUS_VARIANTS[status]} dot>
      {unitStatusLabel(t, status)}
    </StatusBadge>
  )
}

function Swatch({ className, style, label }: { className: string; style?: React.CSSProperties; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
      <span aria-hidden className={cn('inline-block size-3 rounded-sm', className)} style={style} />
      {label}
    </span>
  )
}

export function FloorPlanLegend({ thresholdDays }: { thresholdDays: number | null }) {
  const t = useT()
  const { plural } = usePlural()
  return (
    <div className="flex flex-col gap-2" data-testid="pm-floor-plan-legend">
      <LegendGroup label={t('property_management.floorPlan.legend.leasable', 'Leasable units')}>
        <StatusChip status="occupied" />
        <StatusChip status="available" />
        <StatusChip status="unavailable" />
        <Badge variant="warning" title={thresholdDays !== null ? plural('property_management.floorPlan.legend.leaseEndingHint', 'The lease ends within {count} days', thresholdDays) : undefined}>
          <Clock aria-hidden className="size-3" />
          {t('property_management.floorPlan.legend.leaseEnding', 'Lease ending')}
        </Badge>
        <Badge variant="info">
          <Send aria-hidden className="size-3" />
          {t('property_management.floorPlan.legend.proposed', 'Proposed')}
        </Badge>
      </LegendGroup>
      <LegendGroup label={t('property_management.floorPlan.legend.bookable', 'Bookable units')}>
        <StatusChip status="booked" />
        <StatusChip status="free" />
      </LegendGroup>
      <LegendGroup label={t('property_management.floorPlan.legend.areas', 'Areas')}>
        <Swatch className="border-2 border-dashed border-border" label={t('property_management.floors.legend.space', 'Space')} />
        <Swatch className="border border-border bg-muted" label={t('property_management.floors.legend.commonArea', 'Common area')} />
        <Swatch className="border border-status-warning-border" style={HATCH_STYLE} label={t('property_management.floorPlan.legend.unavailableArea', 'Unavailable area')} />
      </LegendGroup>
    </div>
  )
}
