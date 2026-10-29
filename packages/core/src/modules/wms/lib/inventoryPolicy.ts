import type {
  InventoryLotStatus,
  InventoryStrategy,
  WarehouseLocationType,
} from '../data/entities'

type LotEligibilityInput = {
  status?: InventoryLotStatus | null
  expiresAt?: Date | null
} | null | undefined

/** Staging/dock hold inbound stock; Phase 2 must not treat them as pick/reserve candidates. */
export const NON_RESERVABLE_LOCATION_TYPES: ReadonlySet<WarehouseLocationType> = new Set([
  'staging',
  'dock',
])

export function isReservableLocationType(type: string | null | undefined): boolean {
  if (typeof type !== 'string' || type.length === 0) return true
  return !NON_RESERVABLE_LOCATION_TYPES.has(type as WarehouseLocationType)
}

/**
 * Returns false when the balance sits on staging/dock. Unpopulated location FKs
 * (string id only) stay eligible so callers that omit `populate: ['location']`
 * do not accidentally empty the candidate set.
 */
export function isBalanceLocationReservable(balance: { location?: unknown }): boolean {
  const location = balance.location
  if (!location || typeof location === 'string') return true
  const type =
    typeof (location as { type?: unknown }).type === 'string'
      ? (location as { type: string }).type
      : null
  return isReservableLocationType(type)
}

export function isLotEligible(lot: LotEligibilityInput, now: Date = new Date()): boolean {
  if (!lot) return true
  if (lot.status !== 'available') return false
  if (lot.expiresAt && lot.expiresAt.getTime() <= now.getTime()) return false
  return true
}

type NumericLike = string | number | null | undefined

type StrategyProfile = {
  trackExpiration?: boolean | null
  defaultStrategy?: InventoryStrategy | null
}

type LowStockProfile = {
  reorderPoint?: NumericLike
  safetyStock?: NumericLike
}

export type InventoryStrategyBucket = {
  warehouseId: string
  locationId: string
  catalogVariantId: string
  createdAt: Date
  lotId?: string | null
  lotExpiresAt?: Date | null
  serialNumber?: string | null
}

function toNumber(value: NumericLike): number {
  if (typeof value === 'number') return value
  if (typeof value === 'string' && value.trim().length > 0) {
    return Number(value)
  }
  return 0
}

function buildBucketKey(bucket: InventoryStrategyBucket): string {
  return [
    bucket.warehouseId,
    bucket.locationId,
    bucket.catalogVariantId,
    bucket.lotId ?? '',
    bucket.serialNumber ?? '',
  ].join('::')
}

function resolveBucketSortValue(
  bucket: InventoryStrategyBucket,
  strategy: InventoryStrategy,
  receiptMap: Map<string, Date>,
): number {
  const receiptAt = receiptMap.get(buildBucketKey(bucket))
  if (strategy === 'fefo') {
    return bucket.lotExpiresAt?.getTime() ?? Number.MAX_SAFE_INTEGER
  }
  return receiptAt?.getTime() ?? bucket.createdAt.getTime()
}

export function sortBucketsForStrategy<T extends InventoryStrategyBucket>(
  buckets: T[],
  strategy: InventoryStrategy,
  receiptMap: Map<string, Date>,
): T[] {
  return [...buckets].sort((left, right) => {
    const leftValue = resolveBucketSortValue(left, strategy, receiptMap)
    const rightValue = resolveBucketSortValue(right, strategy, receiptMap)
    if (leftValue === rightValue) {
      return left.createdAt.getTime() - right.createdAt.getTime()
    }
    return strategy === 'lifo' ? rightValue - leftValue : leftValue - rightValue
  })
}

export function resolveReservationStrategyFromProfile(
  profile: StrategyProfile | null | undefined,
  requestedStrategy?: InventoryStrategy | null,
): InventoryStrategy {
  if (profile?.trackExpiration) return 'fefo'
  return requestedStrategy ?? profile?.defaultStrategy ?? 'fifo'
}

export function evaluateLowStock(
  profile: LowStockProfile,
  availableQuantity: number,
):
  | {
      state: 'below_safety_stock' | 'below_reorder_point'
      reorderPoint: NumericLike
      safetyStock: NumericLike
      availableQuantity: string
    }
  | null {
  const reorderPoint = toNumber(profile.reorderPoint)
  if (availableQuantity > reorderPoint) return null

  const safetyStock = toNumber(profile.safetyStock)
  return {
    state: availableQuantity <= safetyStock ? 'below_safety_stock' : 'below_reorder_point',
    reorderPoint: profile.reorderPoint,
    safetyStock: profile.safetyStock,
    availableQuantity: String(availableQuantity),
  }
}
