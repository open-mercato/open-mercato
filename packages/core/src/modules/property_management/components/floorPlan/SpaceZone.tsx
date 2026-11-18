"use client"

import * as React from 'react'
import { cn } from '@open-mercato/shared/lib/utils'
import { rectStyle } from '../floor/scale'
import type { LayoutRect } from '../floor/types'
import { HATCH_STYLE } from './floorPlanModel'

export type SpaceZoneVariant = 'space' | 'commonArea'

export type SpaceZoneProps = {
  rect: LayoutRect
  sizeX: number
  sizeY: number
  variant: SpaceZoneVariant
  label: string
  unavailableLabel?: string | null
  testId?: string
}

const VARIANT_CLASSES: Record<SpaceZoneVariant, string> = {
  space: 'border-2 border-dashed border-border',
  commonArea: 'border border-border bg-muted',
}

export function SpaceZone({ rect, sizeX, sizeY, variant, label, unavailableLabel, testId }: SpaceZoneProps) {
  const hatched = Boolean(unavailableLabel)
  return (
    <div
      data-testid={testId}
      data-unavailable={hatched ? 'true' : undefined}
      className={cn('pointer-events-none absolute overflow-hidden rounded-sm', VARIANT_CLASSES[variant], hatched ? 'border-status-warning-border' : null)}
      style={{ ...rectStyle(rect, sizeX, sizeY), ...(hatched ? HATCH_STYLE : null) }}
    >
      <span className={cn('relative z-10 flex max-w-full items-center gap-1', hatched ? 'm-0.5' : null)}>
        <span className={cn('min-w-0 shrink-0 truncate px-1 text-xs font-medium text-muted-foreground', hatched ? 'rounded-sm bg-background' : null)}>{label}</span>
        {unavailableLabel ? (
          <span className="min-w-0 truncate rounded-sm bg-background px-1 text-xs text-status-warning-text" title={unavailableLabel}>
            {unavailableLabel}
          </span>
        ) : null}
      </span>
    </div>
  )
}

export type HatchedFloorProps = { label: string }

export function HatchedFloor({ label }: HatchedFloorProps) {
  return (
    <div
      data-testid="pm-floor-plan-floor-unavailable"
      className="pointer-events-none absolute inset-0 flex items-end"
      style={HATCH_STYLE}
    >
      <span className="m-1 rounded-sm bg-background px-1 text-xs text-status-warning-text">{label}</span>
    </div>
  )
}
