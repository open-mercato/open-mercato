"use client"

import * as React from 'react'
import { useLocale, useT, type TranslateFn } from '@open-mercato/shared/lib/i18n/context'
import { FloorDrawing } from '../floor/FloorDrawing'
import { pixelsPerMetre } from '../floor/scale'
import { closureReason, describeUnavailableUntil, readingOrder, verticalNeighbour, type FloorPlanLayout, type UnavailableArea } from './floorPlanModel'
import { HatchedFloor, SpaceZone } from './SpaceZone'
import { UnitTile } from './UnitTile'

export type FloorPlanCanvasProps = {
  layout: FloorPlanLayout
  selectedUnitId: string | null
  onSelectUnit: (unitId: string) => void
}

const NAVIGATION_KEYS = new Set(['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp', 'Home', 'End'])

function areaLabel(t: TranslateFn, area: UnavailableArea, locale: string): string {
  const until = describeUnavailableUntil(t, area.until, locale)
  if (area.subjectType === 'building' && area.from === null && area.reasonText === null) {
    return t('property_management.floorPlan.unavailable.archived', 'Building archived')
  }
  return t('property_management.floorPlan.unavailable.area', 'Unavailable: {reason} ({until})', {
    reason: closureReason(t, area),
    until,
  })
}

export function FloorPlanCanvas({ layout, selectedUnitId, onSelectUnit }: FloorPlanCanvasProps) {
  const t = useT()
  const locale = useLocale()
  const { floor, spaces, units, commonAreas } = layout
  const pxPerMetre = pixelsPerMetre(layout.floors, floor.sizeX)
  const areas = layout.unavailableAreas ?? []
  const floorArea = areas.find((area) => area.subjectType === 'building' || area.subjectType === 'floor') ?? null
  const spaceAreas = new Map(areas.filter((area) => area.subjectType === 'space').map((area) => [area.subjectId, area]))
  const divided = spaces.length > 1 || spaces.some((space) => !space.isDefault)
  const ordered = React.useMemo(() => readingOrder(units), [units])
  const [focusedUnitId, setFocusedUnitId] = React.useState<string | null>(null)
  const tabStopId = [focusedUnitId, selectedUnitId].find((id) => id && ordered.some((unit) => unit.id === id)) ?? ordered[0]?.id ?? null

  const handleFocus = (event: React.FocusEvent<HTMLDivElement>) => {
    const unitId = (event.target as HTMLElement).dataset.unitId
    if (unitId) setFocusedUnitId(unitId)
  }

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (!NAVIGATION_KEYS.has(event.key) || !ordered.length) return
    if (event.altKey || event.metaKey || event.ctrlKey || event.shiftKey) return
    const target = event.target as HTMLElement
    const currentId = target.dataset.unitId ?? null
    const index = ordered.findIndex((unit) => unit.id === currentId)
    if (index < 0) return
    event.preventDefault()
    const step = event.key === 'ArrowRight' ? 1 : -1
    const nextIndex = event.key === 'Home' ? 0 : event.key === 'End' ? ordered.length - 1 : (index + step + ordered.length) % ordered.length
    const nextUnit = event.key === 'ArrowDown' || event.key === 'ArrowUp'
      ? verticalNeighbour(ordered, ordered[index], event.key === 'ArrowDown' ? 1 : -1)
      : ordered[nextIndex]
    if (!nextUnit) return
    const next = event.currentTarget.querySelector<HTMLElement>(`[data-unit-id="${nextUnit.id}"]`)
    next?.focus()
  }

  return (
    <div onKeyDown={handleKeyDown} onFocus={handleFocus}>
      <FloorDrawing
        sizeX={floor.sizeX}
        sizeY={floor.sizeY}
        pxPerMetre={pxPerMetre}
        interactive
        ariaLabel={t('property_management.floorPlan.ariaLabel', 'Floor {name} drawn to scale, units by status', { name: floor.name })}
      >
        {floorArea ? <HatchedFloor label={areaLabel(t, floorArea, locale)} /> : null}
        {spaces
          .filter((space) => divided || spaceAreas.has(space.id))
          .map((space) => {
            const area = spaceAreas.get(space.id)
            return (
              <SpaceZone
                key={space.id}
                testId={`pm-floor-plan-space-${space.id}`}
                rect={space}
                sizeX={floor.sizeX}
                sizeY={floor.sizeY}
                variant="space"
                label={space.name}
                unavailableLabel={area ? areaLabel(t, area, locale) : null}
              />
            )
          })}
        {commonAreas.map((area) => (
          <SpaceZone key={area.id} rect={area} sizeX={floor.sizeX} sizeY={floor.sizeY} variant="commonArea" label={area.name} />
        ))}
        {ordered.map((unit) => (
          <UnitTile
            key={unit.id}
            unit={unit}
            sizeX={floor.sizeX}
            sizeY={floor.sizeY}
            selected={unit.id === selectedUnitId}
            tabStop={unit.id === tabStopId}
            onSelect={onSelectUnit}
          />
        ))}
      </FloorDrawing>
    </div>
  )
}
