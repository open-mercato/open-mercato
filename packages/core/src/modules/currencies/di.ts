import type { AppContainer } from '@/lib/di/container'
import type { EntityManager } from '@mikro-orm/core'
import { RateFetchingService } from './services/rateFetchingService'

export function register(container: AppContainer) {
  container.register({
    rateFetchingService: {
      resolve: (c) => {
        const em = c.resolve<EntityManager>('em')
        return new RateFetchingService(em)
      },
    },
  })
}

