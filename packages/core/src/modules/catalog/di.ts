import { asFunction } from 'awilix'
import type { AppContainer } from '@/lib/di/container'
import { DefaultCatalogPricingService } from './services/catalogPricingService'

export function register(container: AppContainer) {
  container.register({
    catalogPricingService: asFunction(({ eventBus }: AppContainer) => {
      return new DefaultCatalogPricingService(eventBus ?? null)
    }).singleton(),
  })
}
