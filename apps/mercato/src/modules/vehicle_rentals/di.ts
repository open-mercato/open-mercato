import { asValue } from 'awilix'
import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import { RentalContract, RentalDocumentSequence, RentalVehicleCheck } from './data/entities'

export function register(container: AppContainer) {
  container.register({
    RentalContract: asValue(RentalContract),
    RentalVehicleCheck: asValue(RentalVehicleCheck),
    RentalDocumentSequence: asValue(RentalDocumentSequence),
  })
}
