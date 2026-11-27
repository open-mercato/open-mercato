import { defineProcessDiRegistrar, registerProcessActivation } from '@open-mercato/shared/lib/di/process-registrar'
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

function registerWithActivation(container: AppContainer, activate: (callback: () => void) => void) {
  container.register({
    Warehouse: asValue(Warehouse),
    WarehouseZone: asValue(WarehouseZone),
    WarehouseLocation: asValue(WarehouseLocation),
    ProductInventoryProfile: asValue(ProductInventoryProfile),
    InventoryLot: asValue(InventoryLot),
    InventoryBalance: asValue(InventoryBalance),
    InventoryReservation: asValue(InventoryReservation),
    InventoryMovement: asValue(InventoryMovement),
    wmsReservationService: asFunction(() => new WmsReservationService()).scoped().proxy(),
  })

  activate(() => {
    if (availabilityProviderRegistry.get(WMS_AVAILABILITY_PROVIDER_ID) !== wmsAvailabilityProvider) {
      availabilityProviderRegistry.register(wmsAvailabilityProvider)
    }
  })
}

export function register(container: AppContainer): void {
  registerWithActivation(container, (activate) => activate())
}

defineProcessDiRegistrar((container: AppContainer) => {
  registerWithActivation(container, (activate) => registerProcessActivation(container, activate))
}, { legacy: register })
