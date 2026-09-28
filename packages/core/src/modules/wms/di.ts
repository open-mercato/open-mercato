import { asValue } from 'awilix'
import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import { availabilityProviderRegistry } from '@open-mercato/shared/lib/availability'
import {
  InventoryBalance,
  InventoryLot,
  InventoryMovement,
  InventoryReservation,
  ProductInventoryProfile,
  Warehouse,
  WarehouseLocation,
  WarehouseZone,
} from './data/entities'
import { createWmsAvailabilityProvider } from './lib/availabilityProvider'

export function register(container: AppContainer) {
  container.register({
    Warehouse: asValue(Warehouse),
    WarehouseZone: asValue(WarehouseZone),
    WarehouseLocation: asValue(WarehouseLocation),
    ProductInventoryProfile: asValue(ProductInventoryProfile),
    InventoryLot: asValue(InventoryLot),
    InventoryBalance: asValue(InventoryBalance),
    InventoryReservation: asValue(InventoryReservation),
    InventoryMovement: asValue(InventoryMovement),
  })

  // Explicit, idempotent (replace-by-id) registration into the shared,
  // dependency-free registry — never "same DI key, load order wins" (§3.1).
  availabilityProviderRegistry.register(createWmsAvailabilityProvider(container))
}
