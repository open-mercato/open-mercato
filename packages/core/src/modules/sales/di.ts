import { asFunction } from 'awilix'
import type { AppContainer } from '@/lib/di/container'
import { DefaultSalesCalculationService } from './services/salesCalculationService'

export function register(container: AppContainer) {
  container.register({
    salesCalculationService: asFunction((cradle) => {
      const eventBus = cradle.eventBus ?? null
      return new DefaultSalesCalculationService(eventBus)
    }).singleton(),
  })
}
