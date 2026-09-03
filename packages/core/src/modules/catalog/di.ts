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
    // `.proxy()` is mandatory: the container runs InjectionMode.CLASSIC, which injects by
    // parameter name, so a destructuring factory silently receives `undefined` without it.
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
