import { asFunction, asValue } from 'awilix'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import type { ModuleConfigService } from '@open-mercato/core/modules/configs/lib/module-config-service'
import type { BaseCurrencyService } from '@open-mercato/core/modules/currencies/services/baseCurrencyService'
import { createCustomerGroupsService } from './services/customerGroupsService'
import { createCustomerCreditService } from './services/customerCreditService'
import { createCustomerPurchaseApprovalService } from './services/customerPurchaseApprovalService'
import { CustomerGroup, CustomerGroupMembership } from './data/entities'

type AppCradle = AppContainer['cradle'] & {
  em: EntityManager
}

// Same soft-resolve shape `catalog/di.ts` uses for `catalogOmnibusService` — `configs`
// is an optional peer module (D-R5-27's own `ModuleConfigService` dependency), so a
// harness without it still boots `customerPurchaseApprovalService` with the hard-coded
// 14-day default.
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
    // Step 3.1 (D-R5-37): `currencies` is a soft peer (not in `index.ts`'s own
    // `requires`) — `baseCurrencyService` resolves to `null` through the same
    // `softCradle` shape `customerPurchaseApprovalService` already uses for
    // `moduleConfigService` whenever `currencies` is not registered.
    customerGroupsService: asFunction((cradle: AppCradle) =>
      createCustomerGroupsService(cradle.em, softCradle<BaseCurrencyService>(cradle, 'baseCurrencyService')),
    )
      .singleton()
      .proxy(),
    // Release 5 Phase 3 (G26): its own DI key and interface, registered beside
    // `customerGroupsService` rather than added to it — see `services/customerCreditService.ts`.
    customerCreditService: asFunction(({ em }: AppCradle) => createCustomerCreditService(em))
      .singleton()
      .proxy(),
    // Release 5 Phase 4 (G26): its own DI key and interface, beside `customerCreditService`
    // — see `services/customerPurchaseApprovalService.ts`.
    customerPurchaseApprovalService: asFunction((cradle: AppCradle) =>
      createCustomerPurchaseApprovalService(cradle.em, softCradle<ModuleConfigService>(cradle, 'moduleConfigService')),
    )
      .singleton()
      .proxy(),
    CustomerGroup: asValue(CustomerGroup),
    CustomerGroupMembership: asValue(CustomerGroupMembership),
  })
}
