"use client"

import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { cn } from '@open-mercato/shared/lib/utils'
import type { PlacementIssue, PlacementKind } from '../../lib/geometry'
import { describePlacementIssues } from '../../lib/placementMessages'
import { FloorDrawing, LayoutTile } from '../floor/FloorDrawing'
import { pixelsPerMetre } from '../floor/scale'
import { formatMetres, rectArea, type FloorLayoutData, type LayoutRect } from '../floor/types'
import { evaluatePlacement, issuesKey, rectFromValues } from './placementModel'
import { usePlacementDrag } from './usePlacementDrag'

export type PlacementEditorProps = {
  kind: PlacementKind
  layout: FloorLayoutData
  selfId: string | null
  label: string
  values: Record<string, unknown>
  setValue: (id: string, value: unknown) => void
  current?: LayoutRect | null
  disabled?: boolean
  onIssuesChange: (issues: PlacementIssue[]) => void
}

export function PlacementEditor({ kind, layout, selfId, label, values, setValue, current, disabled, onIssuesChange }: PlacementEditorProps) {
  const t = useT()
  const rect = rectFromValues(values)
  const spaceId = typeof values.spaceId === 'string' && values.spaceId ? values.spaceId : null
  const evaluation = evaluatePlacement(kind, layout, rect, selfId, spaceId)
  const { sizeX, sizeY } = layout.floor
  const translate = React.useCallback(
    (key: string, fallback: string, params?: Record<string, string | number>) => t(key, fallback, params),
    [t],
  )
  const key = issuesKey(evaluation.issues)
  const reportRef = React.useRef(onIssuesChange)
  reportRef.current = onIssuesChange
  React.useEffect(() => {
    reportRef.current(JSON.parse(key) as PlacementIssue[])
  }, [key])

  const onMove = React.useCallback((position: { x: number; y: number }) => {
    setValue('x', position.x)
    setValue('y', position.y)
  }, [setValue])
  const onSettle = React.useCallback((settled: LayoutRect) => {
    if (kind !== 'unit') return
    const next = evaluatePlacement(kind, layout, settled, selfId, spaceId).containingSpaceId
    if (next && next !== spaceId) setValue('spaceId', next)
  }, [kind, layout, selfId, setValue, spaceId])
  const { floorRef, dragging, handlers } = usePlacementDrag({ rect, sizeX, sizeY, disabled, onMove, onSettle })

  const space = spaceId ? layout.spaces.find((item) => item.id === spaceId) ?? null : null
  const area = formatMetres(rectArea(rect))
  const okMessage = kind === 'unit' && space
    ? t('property_management.placement.fitsInSpace', 'Fits inside {space} · {area} m² · no overlaps.', { space: space.name, area })
    : t('property_management.placement.fitsOnFloor', 'Fits on the floor · {area} m² · no overlaps.', { area })
  const blocked = evaluation.issues.length > 0
  const targetLabel = t('property_management.placement.targetLabel', 'Place {name} — drag, or use the arrow keys', { name: label })

  return (
    <div className="space-y-3">
      <p
        role="status"
        aria-live="polite"
        data-testid="placement-status"
        className={cn('text-sm', blocked ? 'text-status-error-text' : 'text-muted-foreground')}
      >
        {blocked ? describePlacementIssues(evaluation.issues, translate) : okMessage}
      </p>
      <dl className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
        <div className="flex gap-2">
          <dt className="text-muted-foreground">{t('property_management.placement.position', 'Position, x, y')}</dt>
          <dd data-testid="placement-position">{`${formatMetres(rect.x)}, ${formatMetres(rect.y)} m`}</dd>
        </div>
        {current ? (
          <div className="flex gap-2 text-muted-foreground">
            <dt>{t('property_management.placement.currently', 'Currently')}</dt>
            <dd>
              {t('property_management.placement.currentRect', '{width} × {depth} m at {x}, {y}', {
                width: formatMetres(current.width),
                depth: formatMetres(current.depth),
                x: formatMetres(current.x),
                y: formatMetres(current.y),
              })}
            </dd>
          </div>
        ) : null}
      </dl>
      <p className="text-xs text-muted-foreground">
        {t('property_management.placement.hint', 'Drag it on the preview to place it — or select it and use the arrow keys (0.5 m steps, Shift for 1 m).')}
      </p>
      <FloorDrawing
        sizeX={sizeX}
        sizeY={sizeY}
        pxPerMetre={pixelsPerMetre(layout.floors, sizeX)}
        ariaLabel={t('property_management.placement.previewLabel', 'Preview of {floor}, drawn to scale', { floor: layout.floor.name })}
        floorRef={floorRef}
        interactive
      >
        {layout.spaces.filter((item) => item.id !== selfId).map((item) => (
          <LayoutTile key={item.id} rect={item} sizeX={sizeX} sizeY={sizeY} variant="space" label={item.name} flagged={evaluation.flaggedIds.has(item.id)} />
        ))}
        {layout.commonAreas.filter((item) => item.id !== selfId).map((item) => (
          <LayoutTile
            key={item.id}
            rect={item}
            sizeX={sizeX}
            sizeY={sizeY}
            variant="commonArea"
            label={item.name}
            faded={kind === 'space'}
            flagged={evaluation.flaggedIds.has(item.id)}
          />
        ))}
        {layout.units.filter((item) => item.id !== selfId).map((item) => (
          <LayoutTile
            key={item.id}
            rect={item}
            sizeX={sizeX}
            sizeY={sizeY}
            variant={item.use === 'bookable' ? 'bookable' : 'leasable'}
            label={item.name}
            faded={kind === 'space' && item.spaceId !== selfId}
            flagged={evaluation.flaggedIds.has(item.id)}
          />
        ))}
        <LayoutTile
          rect={rect}
          sizeX={sizeX}
          sizeY={sizeY}
          variant="target"
          label={label}
          flagged={blocked}
          className={cn(
            'touch-none select-none outline-none focus-visible:ring-2 focus-visible:ring-ring',
            disabled ? 'cursor-not-allowed' : dragging ? 'cursor-grabbing' : 'cursor-grab',
          )}
          tileProps={{
            role: 'application',
            'aria-roledescription': 'draggable',
            'aria-label': targetLabel,
            tabIndex: disabled ? -1 : 0,
            'data-testid': 'placement-target',
            ...handlers,
          }}
        />
      </FloorDrawing>
    </div>
  )
}
