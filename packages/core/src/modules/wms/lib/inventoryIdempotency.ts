import type { InventoryMovementType, InventoryReservationSourceType } from '../data/entities'

function normalizeSegment(value: string | null | undefined): string {
  if (typeof value !== 'string' || value.trim().length === 0) return ''
  return value.trim()
}

function normalizeQuantity(value: number): string {
  return String(value)
}

export function buildMovementIdempotencyKey(input: {
  referenceType: string
  referenceId: string
  type: InventoryMovementType
  warehouseId: string
  locationFromId?: string | null
  locationToId?: string | null
  catalogVariantId: string
  lotId?: string | null
  serialNumber?: string | null
  quantity: number
}): string {
  return [
    'movement',
    normalizeSegment(input.referenceType),
    normalizeSegment(input.referenceId),
    normalizeSegment(input.type),
    normalizeSegment(input.warehouseId),
    normalizeSegment(input.locationFromId),
    normalizeSegment(input.locationToId),
    normalizeSegment(input.catalogVariantId),
    normalizeSegment(input.lotId),
    normalizeSegment(input.serialNumber),
    normalizeQuantity(input.quantity),
  ].join('|')
}

export function buildReservationIdempotencyKey(input: {
  sourceType: InventoryReservationSourceType
  sourceId: string
  catalogVariantId: string
  warehouseId: string
  quantity: number
}): string {
  return [
    'reservation',
    normalizeSegment(input.sourceType),
    normalizeSegment(input.sourceId),
    normalizeSegment(input.catalogVariantId),
    normalizeSegment(input.warehouseId),
    normalizeQuantity(input.quantity),
  ].join('|')
}
