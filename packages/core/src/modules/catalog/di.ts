import { asFunction, asValue } from 'awilix'
import type { CacheStrategy } from '@open-mercato/cache'
import type { EventBus } from '@open-mercato/events'
import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import type { ModuleConfigService } from '@open-mercato/core/modules/configs/lib/module-config-service'
import { DefaultCatalogPricingService } from './services/catalogPricingService'
import { DefaultCatalogOmnibusService } from './services/catalogOmnibusService'
import { CatalogPriceHistoryEntry, CatalogProduct, CatalogProductPrice } from './data/entities'

type AppCradle = AppContainer['cradle'] & {
  eventBus?: EventBus | null
  moduleConfigService: ModuleConfigService
  cache?: CacheStrategy | null
}

export function register(container: AppContainer) {
  container.register({
    // `.proxy()` is mandatory, not decorative: the app container runs in
    // InjectionMode.CLASSIC, where Awilix injects by PARAMETER NAME. A factory
    // whose only parameter is a destructuring pattern has no readable name, so
    // CLASSIC mode passes `undefined` and every dependency silently resolves to
    // nothing. `.proxy()` opts this registration back into cradle injection so
    // the destructuring works. Without it `catalogOmnibusService` was built with
    // `moduleConfigService === undefined` and threw on its first getConfig call.
    catalogPricingService: asFunction(({ eventBus }: AppCradle) => {
      return new DefaultCatalogPricingService(eventBus ?? null)
    })
      .singleton()
      .proxy(),
    // Scoped, not singleton: resolution reads tenant-scoped config per request.
    catalogOmnibusService: asFunction(({ moduleConfigService, cache }: AppCradle) => {
      return new DefaultCatalogOmnibusService(moduleConfigService, cache ?? null)
    })
      .scoped()
      .proxy(),
    CatalogProduct: asValue(CatalogProduct),
    CatalogProductPrice: asValue(CatalogProductPrice),
    CatalogPriceHistoryEntry: asValue(CatalogPriceHistoryEntry),
  })
}
