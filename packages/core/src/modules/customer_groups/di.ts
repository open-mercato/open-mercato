import { asFunction, asValue } from 'awilix'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import type { BaseCurrencyService } from '@open-mercato/core/modules/currencies/services/baseCurrencyService'
import { createCustomerGroupsService } from './services/customerGroupsService'
import { CustomerGroup, CustomerGroupMembership } from './data/entities'

type AppCradle = AppContainer['cradle'] & {
  em: EntityManager
}

// Same soft-resolve shape `catalog/di.ts` uses for `catalogOmnibusService`: `currencies`
// is an optional peer module, so a container without it still boots.
function softCradle<T>(cradle: AppCradle, name: string): T | null {
  try {
    const value = (cradle as Record<string, unknown>)[name]
    return value === undefined || value === null ? null : (value as T)
  } catch {
    return null
  }
}

export function register(container: AppContainer) {
  container.register({
    // `em` is registered per request (`createRequestContainer()` in
    // packages/shared/src/lib/di/container.ts forks a fresh EntityManager and
    // builds a brand-new Awilix container for every request), so `.singleton()`
    // here resolves to "one instance per request container", not one instance for
    // the process — same pattern as `warrantyClaimNumberGenerator` in
    // `warranty_claims/di.ts`.
    // D-R5-37: `currencies` is a soft peer (not in `index.ts`'s `requires`), so
    // `baseCurrencyService` resolves to `null` when it is not registered and the
    // base-currency fallback of `resolveTerms` is skipped.
    customerGroupsService: asFunction((cradle: AppCradle) =>
      createCustomerGroupsService(cradle.em, softCradle<BaseCurrencyService>(cradle, 'baseCurrencyService')),
    )
      .singleton()
      .proxy(),
    CustomerGroup: asValue(CustomerGroup),
    CustomerGroupMembership: asValue(CustomerGroupMembership),
  })
}
