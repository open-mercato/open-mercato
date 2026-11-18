export type LayoutRect = { x: number; y: number; width: number; depth: number }

export type LayoutSpace = LayoutRect & {
  id: string
  name: string
  purpose: string | null
  isDefault: boolean
  unitCount: number
  updatedAt: string
}

export type LayoutUnit = LayoutRect & {
  id: string
  name: string
  spaceId: string
  catalogCategoryId: string
  catalogProductId: string
  categoryName: string | null
  productName: string | null
  use: 'leasable' | 'bookable' | null
  hasBlockers: boolean
  updatedAt: string
}

export type LayoutCommonArea = LayoutRect & {
  id: string
  name: string
  kind: string
  updatedAt: string
}

export type LayoutFloorSummary = { id: string; number: number; name: string; sizeX: number; sizeY: number }

export type FloorLayoutData = {
  building: { id: string; name: string; address: string; status: string; updatedAt: string }
  floor: LayoutFloorSummary & { updatedAt: string }
  floors: LayoutFloorSummary[]
  spaces: LayoutSpace[]
  units: LayoutUnit[]
  commonAreas: LayoutCommonArea[]
}

export const COMMON_AREA_KIND_VALUES = ['corridor', 'kitchen', 'toilets', 'lobby', 'stairs_lifts', 'storage', 'other'] as const

export type CommonAreaKindValue = typeof COMMON_AREA_KIND_VALUES[number]

export function rectArea(rect: LayoutRect): number {
  return Math.round(rect.width * rect.depth * 100) / 100
}

export function formatMetres(value: number, locale: string): string {
  const rounded = Math.round(value * 100) / 100
  try {
    return new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(rounded)
  } catch {
    return String(rounded)
  }
}

export function floorHref(buildingId: string, floorId: string): string {
  return `/backend/property_management/buildings/${buildingId}/floors/${floorId}`
}

export type HatchedSubjects = { floor: boolean; spaceIds: Set<string>; unitIds: Set<string> }

export function hatchedSubjects(layout: FloorLayoutData, unavailableSubjectIds: ReadonlySet<string>): HatchedSubjects {
  const floor = unavailableSubjectIds.has(layout.floor.id) || unavailableSubjectIds.has(layout.building.id) || layout.building.status === 'archived'
  const spaceIds = new Set(layout.spaces.filter((space) => floor || unavailableSubjectIds.has(space.id)).map((space) => space.id))
  const unitIds = new Set(
    layout.units.filter((unit) => floor || spaceIds.has(unit.spaceId) || unavailableSubjectIds.has(unit.id)).map((unit) => unit.id),
  )
  return { floor, spaceIds, unitIds }
}
