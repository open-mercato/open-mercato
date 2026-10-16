import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import type { EntityManager } from '@mikro-orm/core'
import { RateFetchingService } from './services/rateFetchingService'
import { ExchangeRateService } from './services/exchangeRateService'
import { NBPProvider } from './services/providers/nbp'
import { NBPAverageRateProvider } from './services/providers/nbpAverage'
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
        service.registerProvider(new NBPAverageRateProvider())
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
  })
}
