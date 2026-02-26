import { asFunction, asValue } from 'awilix'
import type { EventBus } from '@open-mercato/events'
import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import { DefaultCatalogPricingService } from './services/catalogPricingService'
import { CatalogProduct, CatalogProductPrice } from './data/entities'

type AppCradle = AppContainer['cradle'] & {
  eventBus?: EventBus | null
}

export function register(container: AppContainer) {
  container.register({
    catalogPricingService: asFunction(({ eventBus }: AppCradle) => {
      return new DefaultCatalogPricingService(eventBus ?? null)
    }).singleton(),
    CatalogProduct: asValue(CatalogProduct),
    CatalogProductPrice: asValue(CatalogProductPrice),
  })
}
