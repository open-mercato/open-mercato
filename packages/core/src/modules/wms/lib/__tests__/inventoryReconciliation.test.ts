/** @jest-environment node */

import { recomputeBalanceFromMovements } from '../inventoryReconciliation'
import type { InventoryMovement } from '../../data/entities'

function makeMovement(input: {
  warehouseId: string
  locationFromId?: string | null
  locationToId?: string | null
  catalogVariantId: string
  quantity: string
  lotId?: string | null
  serialNumber?: string | null
}): InventoryMovement {
  return {
    warehouse: input.warehouseId,
    locationFrom: input.locationFromId ?? null,
    locationTo: input.locationToId ?? null,
    catalogVariantId: input.catalogVariantId,
    lot: input.lotId ?? null,
    serialNumber: input.serialNumber ?? null,
    quantity: input.quantity,
  } as InventoryMovement
}

describe('inventoryReconciliation', () => {
  it('recomputes on-hand quantities from signed movement locations', () => {
    const movements = [
      makeMovement({
        warehouseId: 'warehouse-1',
        locationToId: 'location-1',
        catalogVariantId: 'variant-1',
        quantity: '10',
      }),
      makeMovement({
        warehouseId: 'warehouse-1',
        locationFromId: 'location-1',
        locationToId: 'location-2',
        catalogVariantId: 'variant-1',
        quantity: '3',
      }),
      makeMovement({
        warehouseId: 'warehouse-1',
        locationToId: 'location-1',
        catalogVariantId: 'variant-1',
        quantity: '-2',
      }),
    ]

    const onHandByBucket = recomputeBalanceFromMovements(movements)
    expect(onHandByBucket.get('warehouse-1::location-1::variant-1::::')).toBe(5)
    expect(onHandByBucket.get('warehouse-1::location-2::variant-1::::')).toBe(3)
  })
})
