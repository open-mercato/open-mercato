import { asValue } from 'awilix'
import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import {
  FleetVehicle,
  FleetVehicleDocument,
  FleetVehicleAssignment,
  FleetVehicleOdometerLog,
} from './data/entities'

export function register(container: AppContainer) {
  container.register({
    FleetVehicle: asValue(FleetVehicle),
    FleetVehicleDocument: asValue(FleetVehicleDocument),
    FleetVehicleAssignment: asValue(FleetVehicleAssignment),
    FleetVehicleOdometerLog: asValue(FleetVehicleOdometerLog),
  })
}
