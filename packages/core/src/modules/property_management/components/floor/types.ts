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

export function formatMetres(value: number): string {
  return String(Math.round(value * 100) / 100)
}

export function floorHref(buildingId: string, floorId: string): string {
  return `/backend/property_management/buildings/${buildingId}/floors/${floorId}`
}
