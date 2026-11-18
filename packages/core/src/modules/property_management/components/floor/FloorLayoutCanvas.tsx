"use client"

import * as React from 'react'
import { useLocale, useT } from '@open-mercato/shared/lib/i18n/context'
import { cn } from '@open-mercato/shared/lib/utils'
import { FloorDrawing, LayoutTile } from './FloorDrawing'
import { HATCH_STYLE, pixelsPerMetre } from './scale'
import { formatMetres, hatchedSubjects, type FloorLayoutData } from './types'
import { usePlural } from '../plural'

export type FloorLayoutCanvasProps = { layout: FloorLayoutData; unavailableSubjectIds?: ReadonlySet<string> }

function FloorHatch() {
  return <span aria-hidden data-testid="floor-drawing-hatch" className="pointer-events-none absolute inset-0" style={HATCH_STYLE} />
}

function LegendSwatch({ className, label, style }: { className: string; label: string; style?: React.CSSProperties }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
      <span aria-hidden className={cn('inline-block size-3 rounded-sm', className)} style={style} />
      {label}
    </span>
  )
}

export function FloorLayoutCanvas({ layout, unavailableSubjectIds }: FloorLayoutCanvasProps) {
  const t = useT()
  const locale = useLocale()
  const { count } = usePlural()
  const { floor, spaces, units, commonAreas } = layout
  const pxPerMetre = pixelsPerMetre(layout.floors, floor.sizeX)
  const divided = spaces.length > 1 || spaces.some((space) => !space.isDefault)
  const closed = unavailableSubjectIds ?? new Set<string>()
  const hatched = hatchedSubjects(layout, closed)
  const leasable = units.filter((unit) => unit.use === 'leasable').length
  const bookable = units.filter((unit) => unit.use === 'bookable').length
  const summary = t(
    'property_management.floors.layout.summary',
    '{units} — {leasable} leasable, {bookable} bookable · {spaces} · {areas} · {x} × {y} m',
    {
      units: count('units', units.length),
      leasable,
      bookable,
      spaces: count('spaces', spaces.length),
      areas: count('commonAreas', commonAreas.length),
      x: formatMetres(floor.sizeX, locale),
      y: formatMetres(floor.sizeY, locale),
    },
  )
  return (
    <section className="space-y-3 rounded-lg border bg-card p-4" aria-labelledby="pm-floor-layout-title">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 id="pm-floor-layout-title" className="text-base font-semibold">
            {t('property_management.floors.layout.title', 'Layout')}
          </h2>
          <p className="text-sm text-muted-foreground">{summary}</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <LegendSwatch className="border-2 border-dashed border-muted-foreground/60" label={t('property_management.floors.legend.space', 'Space')} />
          <LegendSwatch className="border border-foreground/50 bg-card" label={t('property_management.floors.legend.leasable', 'Leasable unit')} />
          <LegendSwatch className="border border-status-info-border bg-status-info-bg" label={t('property_management.floors.legend.bookable', 'Bookable unit')} />
          <LegendSwatch className="border border-border bg-muted" label={t('property_management.floors.legend.commonArea', 'Common area')} />
          <LegendSwatch className="border border-status-warning-border" style={HATCH_STYLE} label={t('property_management.floorPlan.legend.unavailableArea', 'Unavailable area')} />
        </div>
      </div>
      <FloorDrawing
        sizeX={floor.sizeX}
        sizeY={floor.sizeY}
        pxPerMetre={pxPerMetre}
        ariaLabel={t('property_management.floors.layout.ariaLabel', 'Floor {name} drawn to scale', { name: floor.name })}
      >
        {hatched.floor ? <FloorHatch /> : null}
        {spaces
          .filter((space) => divided || closed.has(space.id))
          .map((space) => (
            <LayoutTile
              key={space.id}
              rect={space}
              sizeX={floor.sizeX}
              sizeY={floor.sizeY}
              variant="space"
              label={space.name}
              hatched={hatched.spaceIds.has(space.id)}
            />
          ))}
        {commonAreas.map((area) => (
          <LayoutTile key={area.id} rect={area} sizeX={floor.sizeX} sizeY={floor.sizeY} variant="commonArea" label={area.name} />
        ))}
        {units.map((unit) => (
          <LayoutTile
            key={unit.id}
            rect={unit}
            sizeX={floor.sizeX}
            sizeY={floor.sizeY}
            variant={unit.use === 'bookable' ? 'bookable' : unit.use === 'leasable' ? 'leasable' : 'unit'}
            label={unit.name}
            sublabel={unit.categoryName}
            hatched={hatched.unitIds.has(unit.id)}
          />
        ))}
      </FloorDrawing>
    </section>
  )
}
