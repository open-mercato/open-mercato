import { asFunction } from 'awilix'
import type { AppContainer } from '@/lib/di/container'
import { DefaultSalesCalculationService } from './services/salesCalculationService'
import { DefaultTaxCalculationService } from './services/taxCalculationService'

export function register(container: AppContainer) {
  container.register({
    salesCalculationService: asFunction((cradle) => {
      const eventBus = cradle.eventBus ?? null
      return new DefaultSalesCalculationService(eventBus)
    }).singleton(),
    taxCalculationService: asFunction(({ em, eventBus }: AppContainer) => {
      return new DefaultTaxCalculationService(em, eventBus ?? null)
    }).singleton(),
  })
}
