import {
  PLACEMENT_SNAP,
  checkPlacement,
  clampInto,
  containingRect,
  firstConflicts,
  fitsInside,
  floorRect,
  overlaps,
  type NamedRect,
  type PlacementContext,
  type PlacementIssue,
  type PlacementKind,
  type Rect,
  type UnitRect,
} from '../../lib/geometry'
import type { FloorLayoutData, LayoutRect } from '../floor/types'

export function toNumber(value: unknown, fallback = 0): number {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' && value.trim().length ? Number(value) : Number.NaN
  return Number.isFinite(parsed) ? parsed : fallback
}

export function rectFromValues(values: Record<string, unknown>): LayoutRect {
  return {
    x: toNumber(values.x),
    y: toNumber(values.y),
    width: toNumber(values.width),
    depth: toNumber(values.depth),
  }
}

function named(item: NamedRect): NamedRect {
  return { id: item.id, name: item.name, x: item.x, y: item.y, width: item.width, depth: item.depth }
}

export function placementContext(layout: FloorLayoutData): PlacementContext {
  const units: UnitRect[] = layout.units.map((unit) => ({ ...named(unit), spaceId: unit.spaceId }))
  return {
    floor: floorRect(layout.floor.sizeX, layout.floor.sizeY),
    spaces: layout.spaces.map(named),
    units,
    commonAreas: layout.commonAreas.map(named),
  }
}

export type PlacementEvaluation = {
  issues: PlacementIssue[]
  flaggedIds: Set<string>
  containingSpaceId: string | null
}

export function evaluatePlacement(
  kind: PlacementKind,
  layout: FloorLayoutData,
  rect: LayoutRect,
  selfId: string | null,
  spaceId: string | null,
): PlacementEvaluation {
  const context = placementContext(layout)
  const issues = checkPlacement({ kind, rect, selfId, spaceId }, context)
  const flaggedIds = new Set<string>()
  const others = <T extends NamedRect>(items: readonly T[]): T[] => items.filter((item) => item.id !== selfId)
  if (kind === 'space') {
    for (const space of others(context.spaces)) if (overlaps(rect, space)) flaggedIds.add(space.id)
    if (selfId) {
      for (const unit of context.units) if (unit.spaceId === selfId && !fitsInside(unit, rect)) flaggedIds.add(unit.id)
    }
  } else {
    for (const unit of kind === 'unit' ? others(context.units) : context.units) if (overlaps(rect, unit)) flaggedIds.add(unit.id)
    for (const area of kind === 'common_area' ? others(context.commonAreas) : context.commonAreas) if (overlaps(rect, area)) flaggedIds.add(area.id)
  }
  const containing = kind === 'unit' ? containingRect(rect, context.spaces) : null
  return { issues, flaggedIds, containingSpaceId: containing?.id ?? null }
}

export function issuesKey(issues: readonly PlacementIssue[]): string {
  return JSON.stringify(issues)
}

export function blockedOnlyBy(issues: readonly PlacementIssue[], kind: PlacementKind, name: string): boolean {
  const overlaps = issues.filter((issue) => issue.code === 'overlaps' && issue.kind === kind)
  return overlaps.length > 0 && overlaps.every((issue) => issue.code === 'overlaps' && issue.names.length === 1 && issue.names[0] === name)
}

function stepsWithin(start: number, span: number, size: number): number[] {
  const values: number[] = []
  const last = start + Math.max(0, span - size)
  for (let value = start; value <= last + 1e-9; value += PLACEMENT_SNAP) values.push(Math.round(value * 100) / 100)
  if (!values.length || values[values.length - 1] < last - 1e-9) values.push(Math.round(last * 100) / 100)
  return values
}

export function placeInsideSpace(rect: Rect, space: Rect, obstacles: readonly Rect[]): Rect {
  for (const y of stepsWithin(space.y, space.depth, rect.depth)) {
    for (const x of stepsWithin(space.x, space.width, rect.width)) {
      const candidate = { ...rect, x, y }
      if (!firstConflicts(candidate, obstacles).length) return clampInto(candidate, space)
    }
  }
  return clampInto({ ...rect, x: space.x, y: space.y }, space)
}

export function unitObstacles(layout: FloorLayoutData, selfId: string | null): Rect[] {
  return [...layout.units.filter((unit) => unit.id !== selfId), ...layout.commonAreas]
}
