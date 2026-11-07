import { asFunction, asValue } from 'awilix'
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
import { WMS_AVAILABILITY_PROVIDER_ID, wmsAvailabilityProvider } from './lib/availabilityProvider'
import { WmsReservationService } from './lib/wmsReservationService'

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
    // A1 extraction (`.ai/specs/analysis/ANALYSIS-2026-10-26-availability-release-5.md`):
    // `wms.inventory.reserve`/`.release` delegate their core logic here as thin
    // wrappers (`commands/inventory-actions.ts`). No container dependency of its
    // own today — `.scoped()` for consistency with this module's DI tokens and
    // in case a future caller (`availability`, Phase 2) needs request-scoped
    // wiring.
    wmsReservationService: asFunction(() => new WmsReservationService()).scoped().proxy(),
  })

  if (availabilityProviderRegistry.get(WMS_AVAILABILITY_PROVIDER_ID) !== wmsAvailabilityProvider) {
    availabilityProviderRegistry.register(wmsAvailabilityProvider)
  }
}
