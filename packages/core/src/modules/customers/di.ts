import { asValue } from 'awilix'
import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import { CustomerEntity, CustomerAddress, CustomerBranch } from './data/entities'

export function register(container: AppContainer) {
  container.register({
    CustomerEntity: asValue(CustomerEntity),
    CustomerAddress: asValue(CustomerAddress),
    CustomerBranch: asValue(CustomerBranch),
  })
}
