/** @jest-environment node */

import {
  evaluateLowStock,
  resolveReservationStrategyFromProfile,
  sortBucketsForStrategy,
  type InventoryStrategyBucket,
} from '../inventoryPolicy'

function makeBucket(
  overrides: Partial<InventoryStrategyBucket> & Pick<InventoryStrategyBucket, 'warehouseId' | 'locationId' | 'catalogVariantId'>,
): InventoryStrategyBucket {
  return {
    warehouseId: overrides.warehouseId,
    locationId: overrides.locationId,
    catalogVariantId: overrides.catalogVariantId,
    createdAt: overrides.createdAt ?? new Date('2026-01-01T00:00:00.000Z'),
    lotId: overrides.lotId ?? null,
    lotExpiresAt: overrides.lotExpiresAt ?? null,
    serialNumber: overrides.serialNumber ?? null,
  }
}

describe('wms inventory policy helpers', () => {
  it('sorts buckets by receipt age for FIFO and reverse age for LIFO', () => {
    const older = makeBucket({
      warehouseId: 'warehouse-1',
      locationId: 'location-1',
      catalogVariantId: 'variant-1',
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
    })
    const newer = makeBucket({
      warehouseId: 'warehouse-1',
      locationId: 'location-2',
      catalogVariantId: 'variant-1',
      createdAt: new Date('2026-01-02T00:00:00.000Z'),
    })

    const receiptMap = new Map<string, Date>([
      ['warehouse-1::location-1::variant-1::::', new Date('2026-01-03T00:00:00.000Z')],
      ['warehouse-1::location-2::variant-1::::', new Date('2026-01-04T00:00:00.000Z')],
    ])

    expect(sortBucketsForStrategy([newer, older], 'fifo', receiptMap)).toEqual([older, newer])
    expect(sortBucketsForStrategy([older, newer], 'lifo', receiptMap)).toEqual([newer, older])
  })

  it('sorts FEFO buckets by earliest expiration regardless of receipt date', () => {
    const longExpiry = makeBucket({
      warehouseId: 'warehouse-1',
      locationId: 'location-1',
      catalogVariantId: 'variant-1',
      lotId: 'lot-1',
      lotExpiresAt: new Date('2026-03-01T00:00:00.000Z'),
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
    })
    const shortExpiry = makeBucket({
      warehouseId: 'warehouse-1',
      locationId: 'location-2',
      catalogVariantId: 'variant-1',
      lotId: 'lot-2',
      lotExpiresAt: new Date('2026-02-01T00:00:00.000Z'),
      createdAt: new Date('2026-01-05T00:00:00.000Z'),
    })

    const receiptMap = new Map<string, Date>([
      ['warehouse-1::location-1::variant-1::lot-1::', new Date('2026-01-02T00:00:00.000Z')],
      ['warehouse-1::location-2::variant-1::lot-2::', new Date('2026-01-01T00:00:00.000Z')],
    ])

    expect(sortBucketsForStrategy([longExpiry, shortExpiry], 'fefo', receiptMap)).toEqual([
      shortExpiry,
      longExpiry,
    ])
  })

  it('forces FEFO when expiration tracking is enabled and otherwise respects explicit strategy', () => {
    expect(
      resolveReservationStrategyFromProfile(
        { trackExpiration: true, defaultStrategy: 'lifo' },
        'fifo',
      ),
    ).toBe('fefo')

    expect(
      resolveReservationStrategyFromProfile(
        { trackExpiration: false, defaultStrategy: 'lifo' },
        'fifo',
      ),
    ).toBe('fifo')

    expect(resolveReservationStrategyFromProfile(null, undefined)).toBe('fifo')
  })

  it('evaluates low-stock threshold state across reorder and safety bands', () => {
    expect(
      evaluateLowStock(
        {
          reorderPoint: '10',
          safetyStock: '4',
        },
        11,
      ),
    ).toBeNull()

    expect(
      evaluateLowStock(
        {
          reorderPoint: '10',
          safetyStock: '4',
        },
        6,
      ),
    ).toEqual({
      state: 'below_reorder_point',
      reorderPoint: '10',
      safetyStock: '4',
      availableQuantity: '6',
    })

    expect(
      evaluateLowStock(
        {
          reorderPoint: '10',
          safetyStock: '4',
        },
        4,
      ),
    ).toEqual({
      state: 'below_safety_stock',
      reorderPoint: '10',
      safetyStock: '4',
      availableQuantity: '4',
    })
  })
})
