"use client"

import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { cn } from '@open-mercato/shared/lib/utils'
import { FloorDrawing, LayoutTile } from './FloorDrawing'
import { pixelsPerMetre } from './scale'
import { formatMetres, type FloorLayoutData } from './types'

export type FloorLayoutCanvasProps = { layout: FloorLayoutData }

function LegendSwatch({ className, label }: { className: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
      <span aria-hidden className={cn('inline-block size-3 rounded-sm', className)} />
      {label}
    </span>
  )
}

export function FloorLayoutCanvas({ layout }: FloorLayoutCanvasProps) {
  const t = useT()
  const { floor, spaces, units, commonAreas } = layout
  const pxPerMetre = pixelsPerMetre(layout.floors, floor.sizeX)
  const divided = spaces.length > 1 || spaces.some((space) => !space.isDefault)
  const leasable = units.filter((unit) => unit.use === 'leasable').length
  const bookable = units.filter((unit) => unit.use === 'bookable').length
  const summary = t(
    'property_management.floors.layout.summary',
    '{units} units — {leasable} leasable, {bookable} bookable · {spaces} spaces · {areas} common areas · {x} × {y} m',
    {
      units: units.length,
      leasable,
      bookable,
      spaces: spaces.length,
      areas: commonAreas.length,
      x: formatMetres(floor.sizeX),
      y: formatMetres(floor.sizeY),
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
          <LegendSwatch className="border border-accent-indigo bg-accent-indigo/10" label={t('property_management.floors.legend.bookable', 'Bookable unit')} />
          <LegendSwatch className="border border-border bg-muted" label={t('property_management.floors.legend.commonArea', 'Common area')} />
        </div>
      </div>
      <FloorDrawing
        sizeX={floor.sizeX}
        sizeY={floor.sizeY}
        pxPerMetre={pxPerMetre}
        ariaLabel={t('property_management.floors.layout.ariaLabel', 'Floor {name} drawn to scale', { name: floor.name })}
      >
        {divided
          ? spaces.map((space) => (
              <LayoutTile key={space.id} rect={space} sizeX={floor.sizeX} sizeY={floor.sizeY} variant="space" label={space.name} />
            ))
          : null}
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
          />
        ))}
      </FloorDrawing>
    </section>
  )
}
