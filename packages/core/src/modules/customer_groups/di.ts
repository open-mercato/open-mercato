import { defineProcessDiRegistrar } from '@open-mercato/shared/lib/di/process-registrar'
import { asFunction, asValue } from 'awilix'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import { createCustomerGroupsService } from './services/customerGroupsService'
import { CustomerGroup, CustomerGroupMembership } from './data/entities'

type AppCradle = AppContainer['cradle'] & {
  em: EntityManager
}

export function register(container: AppContainer) {
  container.register({
    customerGroupsService: asFunction(({ em }: AppCradle) => createCustomerGroupsService(em))
      .scoped()
      .proxy(),
    CustomerGroup: asValue(CustomerGroup),
    CustomerGroupMembership: asValue(CustomerGroupMembership),
  })
}

defineProcessDiRegistrar(register)
