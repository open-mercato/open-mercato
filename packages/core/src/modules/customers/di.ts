import { asValue } from 'awilix'
import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import { CustomerEntity, CustomerAddress } from './data/entities'

export function register(container: AppContainer) {
  container.register({
    CustomerEntity: asValue(CustomerEntity),
    CustomerAddress: asValue(CustomerAddress),
  })
}
