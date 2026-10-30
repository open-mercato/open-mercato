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
    // `em` is registered per request (`createRequestContainer()` in
    // packages/shared/src/lib/di/container.ts forks a fresh EntityManager and
    // builds a brand-new Awilix container for every request), so `.singleton()`
    // here resolves to "one instance per request container", not one instance for
    // the process — same pattern as `warrantyClaimNumberGenerator` in
    // `warranty_claims/di.ts`.
    customerGroupsService: asFunction(({ em }: AppCradle) => createCustomerGroupsService(em))
      .singleton()
      .proxy(),
    CustomerGroup: asValue(CustomerGroup),
    CustomerGroupMembership: asValue(CustomerGroupMembership),
  })
}
