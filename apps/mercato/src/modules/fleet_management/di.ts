import { asFunction, asValue } from 'awilix'
import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import {
  FleetVehicleAssignment,
  FleetVehicleDocument,
  FleetVehicleOdometerLog,
} from './data/entities'
import { createFleetService } from './lib/fleetService'

export function register(container: AppContainer) {
  container.register({
    FleetVehicleDocument: asValue(FleetVehicleDocument),
    FleetVehicleAssignment: asValue(FleetVehicleAssignment),
    FleetVehicleOdometerLog: asValue(FleetVehicleOdometerLog),
    fleetService: asFunction(createFleetService).scoped(),
  })
}
