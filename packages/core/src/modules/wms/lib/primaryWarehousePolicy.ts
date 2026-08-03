import type { EntityManager } from '@mikro-orm/postgresql'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { Warehouse } from '../data/entities'

type Scope = {
  tenantId: string
  organizationId: string
}

export type WarehouseAvailability = {
  warehouseId: string
  available: number
}

export async function resolvePrimaryWarehouseId(
  em: EntityManager,
  scope: Scope,
): Promise<string | null> {
  const warehouse = await findOneWithDecryption(
    em,
    Warehouse,
    {
      organizationId: scope.organizationId,
      isPrimary: true,
      isActive: true,
      deletedAt: null,
    },
    undefined,
    scope,
  )
  return warehouse?.id ?? null
}

export function sortWarehouseAvailabilityForReservation(
  warehouses: WarehouseAvailability[],
  primaryWarehouseId: string | null,
): WarehouseAvailability[] {
  return [...warehouses].sort((left, right) => {
    if (primaryWarehouseId) {
      const leftPrimary = left.warehouseId === primaryWarehouseId ? 1 : 0
      const rightPrimary = right.warehouseId === primaryWarehouseId ? 1 : 0
      if (leftPrimary !== rightPrimary) return rightPrimary - leftPrimary
    }
    return right.available - left.available
  })
}
