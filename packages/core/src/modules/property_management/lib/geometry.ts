export const GEOMETRY_TOLERANCE = 0.01
export const PLACEMENT_SNAP = 0.5

export type Rect = { x: number; y: number; width: number; depth: number }

export type NamedRect = Rect & { id: string; name: string }

export type RectSource = {
  x: string | number
  y: string | number
  width: string | number
  depth: string | number
}

function toNumber(value: string | number): number {
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

export function toRect(source: RectSource): Rect {
  return {
    x: toNumber(source.x),
    y: toNumber(source.y),
    width: toNumber(source.width),
    depth: toNumber(source.depth),
  }
}

export function floorRect(sizeX: string | number, sizeY: string | number): Rect {
  return { x: 0, y: 0, width: toNumber(sizeX), depth: toNumber(sizeY) }
}

export function isValidRect(rect: Rect): boolean {
  return (
    Number.isFinite(rect.x) &&
    Number.isFinite(rect.y) &&
    Number.isFinite(rect.width) &&
    Number.isFinite(rect.depth) &&
    rect.width > GEOMETRY_TOLERANCE &&
    rect.depth > GEOMETRY_TOLERANCE
  )
}

export function fitsInside(rect: Rect, container: Rect, tolerance: number = GEOMETRY_TOLERANCE): boolean {
  return (
    rect.x >= container.x - tolerance &&
    rect.y >= container.y - tolerance &&
    rect.x + rect.width <= container.x + container.width + tolerance &&
    rect.y + rect.depth <= container.y + container.depth + tolerance
  )
}

export function overlaps(a: Rect, b: Rect, tolerance: number = GEOMETRY_TOLERANCE): boolean {
  const overlapX = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)
  const overlapY = Math.min(a.y + a.depth, b.y + b.depth) - Math.max(a.y, b.y)
  return overlapX > tolerance && overlapY > tolerance
}

export function firstConflicts<T extends Rect>(rect: Rect, others: readonly T[], tolerance: number = GEOMETRY_TOLERANCE): T[] {
  return others.filter((other) => overlaps(rect, other, tolerance))
}

export function outsideOf<T extends Rect>(container: Rect, items: readonly T[], tolerance: number = GEOMETRY_TOLERANCE): T[] {
  return items.filter((item) => !fitsInside(item, container, tolerance))
}

export function containingRect<T extends Rect>(rect: Rect, candidates: readonly T[], tolerance: number = GEOMETRY_TOLERANCE): T | null {
  return candidates.find((candidate) => fitsInside(rect, candidate, tolerance)) ?? null
}

export function rectArea(rect: Rect): number {
  return roundMetres(rect.width * rect.depth)
}

export function roundMetres(value: number): number {
  return Math.round(value * 100) / 100
}

export function snapTo(value: number, step: number = PLACEMENT_SNAP): number {
  if (!Number.isFinite(value) || step <= 0) return value
  return roundMetres(Math.round(value / step) * step)
}

export function clampInto(rect: Rect, container: Rect): Rect {
  const maxX = container.x + Math.max(0, container.width - rect.width)
  const maxY = container.y + Math.max(0, container.depth - rect.depth)
  return {
    ...rect,
    x: roundMetres(Math.min(Math.max(rect.x, container.x), maxX)),
    y: roundMetres(Math.min(Math.max(rect.y, container.y), maxY)),
  }
}

export function sameRect(a: Rect, b: Rect, tolerance: number = GEOMETRY_TOLERANCE): boolean {
  return (
    Math.abs(a.x - b.x) <= tolerance &&
    Math.abs(a.y - b.y) <= tolerance &&
    Math.abs(a.width - b.width) <= tolerance &&
    Math.abs(a.depth - b.depth) <= tolerance
  )
}

export type PlacementKind = 'unit' | 'space' | 'common_area'

export type UnitRect = NamedRect & { spaceId?: string | null }

export type PlacementContext = {
  floor: Rect
  spaces: readonly NamedRect[]
  units: readonly UnitRect[]
  commonAreas: readonly NamedRect[]
}

export type PlacementIssue =
  | { code: 'invalid_size' }
  | { code: 'outside_floor' }
  | { code: 'outside_space'; spaceName: string | null }
  | { code: 'overlaps'; kind: PlacementKind; names: string[] }
  | { code: 'strands_units'; names: string[] }

export type PlacementCheckInput = {
  kind: PlacementKind
  rect: Rect
  selfId?: string | null
  spaceId?: string | null
}

function exclude<T extends NamedRect>(items: readonly T[], selfId: string | null | undefined): T[] {
  return selfId ? items.filter((item) => item.id !== selfId) : [...items]
}

export function checkPlacement(input: PlacementCheckInput, context: PlacementContext): PlacementIssue[] {
  const { rect, kind, selfId } = input
  if (!isValidRect(rect)) return [{ code: 'invalid_size' }]
  const issues: PlacementIssue[] = []
  if (!fitsInside(rect, context.floor)) issues.push({ code: 'outside_floor' })
  if (kind === 'space') {
    const spaceConflicts = firstConflicts(rect, exclude(context.spaces, selfId))
    if (spaceConflicts.length) issues.push({ code: 'overlaps', kind: 'space', names: spaceConflicts.map((item) => item.name) })
    if (selfId) {
      const ownUnits = context.units.filter((unit) => unit.spaceId === selfId)
      const stranded = outsideOf(rect, ownUnits)
      if (stranded.length) issues.push({ code: 'strands_units', names: stranded.map((item) => item.name) })
    }
    return issues
  }
  if (kind === 'unit') {
    const space = input.spaceId ? context.spaces.find((item) => item.id === input.spaceId) ?? null : null
    if (!space || !fitsInside(rect, space)) issues.push({ code: 'outside_space', spaceName: space?.name ?? null })
  }
  const unitConflicts = firstConflicts(rect, kind === 'unit' ? exclude(context.units, selfId) : context.units)
  if (unitConflicts.length) issues.push({ code: 'overlaps', kind: 'unit', names: unitConflicts.map((item) => item.name) })
  const areaConflicts = firstConflicts(rect, kind === 'common_area' ? exclude(context.commonAreas, selfId) : context.commonAreas)
  if (areaConflicts.length) issues.push({ code: 'overlaps', kind: 'common_area', names: areaConflicts.map((item) => item.name) })
  return issues
}
