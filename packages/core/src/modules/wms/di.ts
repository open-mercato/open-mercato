import { asValue } from 'awilix'
import type { AppContainer } from '@open-mercato/shared/lib/di/container'
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
}
