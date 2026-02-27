import { asFunction, asValue } from 'awilix'
import type { EventBus } from '@open-mercato/events'
import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import type { CacheStrategy } from '@open-mercato/cache'
import type { ModuleConfigService } from '@open-mercato/core/modules/configs/lib/module-config-service'
import { DefaultCatalogPricingService } from './services/catalogPricingService'
import { DefaultCatalogOmnibusService } from './services/catalogOmnibusService'
import { CatalogProduct, CatalogProductPrice } from './data/entities'

type AppCradle = AppContainer['cradle'] & {
  eventBus?: EventBus | null
  cache: CacheStrategy
  moduleConfigService: ModuleConfigService
}

export function register(container: AppContainer) {
  container.register({
    catalogPricingService: asFunction(({ eventBus }: AppCradle) => {
      return new DefaultCatalogPricingService(eventBus ?? null)
    }).singleton(),
    catalogOmnibusService: asFunction(() => {
      const moduleConfigService = container.resolve<ModuleConfigService>('moduleConfigService')
      const cache = container.resolve<CacheStrategy>('cache')
      return new DefaultCatalogOmnibusService(moduleConfigService, cache)
    }).singleton(),
    CatalogProduct: asValue(CatalogProduct),
    CatalogProductPrice: asValue(CatalogProductPrice),
  })
}
