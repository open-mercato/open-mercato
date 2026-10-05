import { asFunction, asValue } from 'awilix'
import type { CacheStrategy } from '@open-mercato/cache'
import type { EventBus } from '@open-mercato/events'
import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import type { ModuleConfigService } from '@open-mercato/core/modules/configs/lib/module-config-service'
import { DefaultCatalogPricingService } from './services/catalogPricingService'
import { DefaultCatalogOmnibusService } from './services/catalogOmnibusService'
import { CatalogProduct, CatalogProductPrice, CatalogProductVariant } from './data/entities'

type AppCradle = AppContainer['cradle'] & {
  eventBus?: EventBus | null
}

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
    catalogPricingService: asFunction(({ eventBus }: AppCradle) => {
      return new DefaultCatalogPricingService(eventBus ?? null)
    })
      .singleton()
      .proxy(),
    catalogOmnibusService: asFunction((cradle: AppCradle) => {
      return new DefaultCatalogOmnibusService(
        softCradle<ModuleConfigService>(cradle, 'moduleConfigService'),
        softCradle<CacheStrategy>(cradle, 'cache'),
      )
    })
      .scoped()
      .proxy(),
    CatalogProduct: asValue(CatalogProduct),
    CatalogProductPrice: asValue(CatalogProductPrice),
    CatalogProductVariant: asValue(CatalogProductVariant),
  })
}
