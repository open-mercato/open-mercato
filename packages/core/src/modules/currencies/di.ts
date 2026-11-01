import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import type { EntityManager } from '@mikro-orm/core'
import { RateFetchingService } from './services/rateFetchingService'
import { ExchangeRateService } from './services/exchangeRateService'
import { NBPProvider } from './services/providers/nbp'
import { RaiffeisenPolandProvider } from './services/providers/raiffeisen'
import { listCurrencyRateProviders } from './services/providers/registry'
import { BaseCurrencyService } from './services/baseCurrencyService'

export function register(container: AppContainer) {
  container.register({
    rateFetchingService: {
      resolve: (c) => {
        const em = c.resolve<EntityManager>('em')
        const service = new RateFetchingService(em)
        
        // Register default providers
        service.registerProvider(new NBPProvider())
        service.registerProvider(new RaiffeisenPolandProvider())
        for (const provider of listCurrencyRateProviders()) service.registerProvider(provider)
        
        return service
      },
    },
    exchangeRateService: {
      resolve: (c) => {
        const em = c.resolve<EntityManager>('em')
        const rateFetchingService = c.resolve<RateFetchingService>('rateFetchingService')
        return new ExchangeRateService(em, rateFetchingService)
      },
    },
    baseCurrencyService: {
      resolve: (c) => new BaseCurrencyService(c.resolve<EntityManager>('em')),
    },
    // Lets an optional-peer caller that already holds its OWN `EntityManager` (e.g. a
    // transaction with a per-cart `pg_advisory_xact_lock` held, `cart/lib/approvalGate.ts`)
    // build a `BaseCurrencyService` bound to THAT connection instead of the container's
    // request-root `em` `baseCurrencyService` above is bound to — resolved through DI (never
    // a static value import of `BaseCurrencyService` into a module that only soft-depends on
    // `currencies`) so the caller still degrades to `null` when this module isn't registered.
    baseCurrencyServiceFactory: {
      resolve: () => (em: EntityManager) => new BaseCurrencyService(em),
    },
  })
}
