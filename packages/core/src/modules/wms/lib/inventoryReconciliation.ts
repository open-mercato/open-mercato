import type { EntityManager } from '@mikro-orm/postgresql'
import { findOneWithDecryption, findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import {
  InventoryBalance,
  InventoryMovement,
  InventoryReservation,
  type InventoryLot,
} from '../data/entities'

type Scope = {
  tenantId: string
  organizationId: string
}

type AllocationBucket = {
  balanceId?: string
  locationId: string
  lotId: string | null
  serialNumber: string | null
  quantity: number
}

type ReservationMetadata = {
  allocatedBuckets?: AllocationBucket[]
  allocationState?: 'reserved' | 'allocated'
}

export type BalanceBucketKey = {
  warehouseId: string
  locationId: string
  catalogVariantId: string
  lotId: string | null
  serialNumber: string | null
}

export type BalanceDriftRow = {
  balanceId: string
  bucket: BalanceBucketKey
  storedOnHand: number
  expectedOnHand: number
  storedReserved: number
  expectedReserved: number
  storedAllocated: number
  expectedAllocated: number
}

function toNumber(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return 0
}

function buildBucketKey(bucket: BalanceBucketKey): string {
  return [
    bucket.warehouseId,
    bucket.locationId,
    bucket.catalogVariantId,
    bucket.lotId ?? '',
    bucket.serialNumber ?? '',
  ].join('::')
}

function resolveRelationId(value: { id?: string } | string | null | undefined): string | null {
  if (typeof value === 'string') return value
  return typeof value?.id === 'string' ? value.id : null
}

function extractReservationMetadata(reservation: InventoryReservation): ReservationMetadata {
  if (!reservation.metadata || typeof reservation.metadata !== 'object' || Array.isArray(reservation.metadata)) {
    return {}
  }
  return { ...(reservation.metadata as Record<string, unknown>) }
}

export function recomputeBalanceFromMovements(
  movements: InventoryMovement[],
): Map<string, number> {
  const onHandByBucket = new Map<string, number>()
  for (const movement of movements) {
    const warehouseId = resolveRelationId(movement.warehouse)
    if (!warehouseId) continue
    const catalogVariantId = movement.catalogVariantId
    const lotId = resolveRelationId(movement.lot)
    const serialNumber = movement.serialNumber ?? null
    const quantity = toNumber(movement.quantity)
    const locationToId = resolveRelationId(movement.locationTo)
    const locationFromId = resolveRelationId(movement.locationFrom)

    if (locationToId) {
      const key = buildBucketKey({
        warehouseId,
        locationId: locationToId,
        catalogVariantId,
        lotId,
        serialNumber,
      })
      onHandByBucket.set(key, (onHandByBucket.get(key) ?? 0) + quantity)
    }
    if (locationFromId) {
      const key = buildBucketKey({
        warehouseId,
        locationId: locationFromId,
        catalogVariantId,
        lotId,
        serialNumber,
      })
      onHandByBucket.set(key, (onHandByBucket.get(key) ?? 0) - quantity)
    }
  }
  return onHandByBucket
}

function recomputeReservedAllocatedFromReservations(
  reservations: InventoryReservation[],
): {
  reservedByBucket: Map<string, number>
  allocatedByBucket: Map<string, number>
} {
  const reservedByBucket = new Map<string, number>()
  const allocatedByBucket = new Map<string, number>()
  for (const reservation of reservations) {
    if (reservation.status !== 'active') continue
    const warehouseId = resolveRelationId(reservation.warehouse)
    if (!warehouseId) continue
    const metadata = extractReservationMetadata(reservation)
    const buckets = Array.isArray(metadata.allocatedBuckets) ? metadata.allocatedBuckets : []
    const allocationState = metadata.allocationState ?? 'reserved'
    for (const bucket of buckets) {
      const key = buildBucketKey({
        warehouseId,
        locationId: bucket.locationId,
        catalogVariantId: reservation.catalogVariantId,
        lotId: bucket.lotId ?? null,
        serialNumber: bucket.serialNumber ?? null,
      })
      if (allocationState === 'allocated') {
        allocatedByBucket.set(key, (allocatedByBucket.get(key) ?? 0) + toNumber(bucket.quantity))
      } else {
        reservedByBucket.set(key, (reservedByBucket.get(key) ?? 0) + toNumber(bucket.quantity))
      }
    }
  }
  return { reservedByBucket, allocatedByBucket }
}

export async function verifyBalances(
  em: EntityManager,
  scope: Scope,
  filters?: {
    warehouseId?: string
    catalogVariantId?: string
  },
): Promise<BalanceDriftRow[]> {
  const balanceWhere: Record<string, unknown> = {
    organizationId: scope.organizationId,
    tenantId: scope.tenantId,
    deletedAt: null,
  }
  if (filters?.warehouseId) balanceWhere.warehouse = filters.warehouseId
  if (filters?.catalogVariantId) balanceWhere.catalogVariantId = filters.catalogVariantId

  const movementWhere: Record<string, unknown> = {
    organizationId: scope.organizationId,
    tenantId: scope.tenantId,
    deletedAt: null,
  }
  if (filters?.warehouseId) movementWhere.warehouse = filters.warehouseId
  if (filters?.catalogVariantId) movementWhere.catalogVariantId = filters.catalogVariantId

  const reservationWhere: Record<string, unknown> = {
    organizationId: scope.organizationId,
    tenantId: scope.tenantId,
    status: 'active',
    deletedAt: null,
  }
  if (filters?.warehouseId) reservationWhere.warehouse = filters.warehouseId
  if (filters?.catalogVariantId) reservationWhere.catalogVariantId = filters.catalogVariantId

  const [balances, movements, reservations] = await Promise.all([
    findWithDecryption(em, InventoryBalance, balanceWhere, undefined, scope),
    findWithDecryption(em, InventoryMovement, movementWhere, undefined, scope),
    findWithDecryption(em, InventoryReservation, reservationWhere, undefined, scope),
  ])

  const onHandByBucket = recomputeBalanceFromMovements(movements)
  const { reservedByBucket, allocatedByBucket } = recomputeReservedAllocatedFromReservations(reservations)

  const driftRows: BalanceDriftRow[] = []
  for (const balance of balances) {
    const warehouseId = resolveRelationId(balance.warehouse)
    const locationId = resolveRelationId(balance.location)
    if (!warehouseId || !locationId) continue
    const lotId = resolveRelationId(balance.lot)
    const bucket: BalanceBucketKey = {
      warehouseId,
      locationId,
      catalogVariantId: balance.catalogVariantId,
      lotId,
      serialNumber: balance.serialNumber ?? null,
    }
    const key = buildBucketKey(bucket)
    const expectedOnHand = onHandByBucket.get(key) ?? 0
    const expectedReserved = reservedByBucket.get(key) ?? 0
    const expectedAllocated = allocatedByBucket.get(key) ?? 0
    const storedOnHand = toNumber(balance.quantityOnHand)
    const storedReserved = toNumber(balance.quantityReserved)
    const storedAllocated = toNumber(balance.quantityAllocated)

    const onHandDrift = Math.abs(storedOnHand - expectedOnHand) > 0.000001
    const reservedDrift = Math.abs(storedReserved - expectedReserved) > 0.000001
    const allocatedDrift = Math.abs(storedAllocated - expectedAllocated) > 0.000001
    if (!onHandDrift && !reservedDrift && !allocatedDrift) continue

    driftRows.push({
      balanceId: balance.id,
      bucket,
      storedOnHand,
      expectedOnHand,
      storedReserved,
      expectedReserved,
      storedAllocated,
      expectedAllocated,
    })
  }

  return driftRows
}

export async function repairBalanceDrift(
  em: EntityManager,
  scope: Scope,
  driftRows: BalanceDriftRow[],
): Promise<number> {
  let repaired = 0
  for (const row of driftRows) {
    const balance = await findOneWithDecryption(
      em,
      InventoryBalance,
      {
        id: row.balanceId,
        organizationId: scope.organizationId,
        tenantId: scope.tenantId,
        deletedAt: null,
      },
      undefined,
      scope,
    )
    if (!balance) continue
    balance.quantityOnHand = String(row.expectedOnHand)
    balance.quantityReserved = String(row.expectedReserved)
    balance.quantityAllocated = String(row.expectedAllocated)
    repaired += 1
  }
  if (repaired > 0) {
    await em.flush()
  }
  return repaired
}

export type { InventoryLot }
